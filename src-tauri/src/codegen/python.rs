use crate::codegen::launch::render_package_launch_files;
use crate::codegen::regions::{end_marker, start_marker, CommentStyle};
use crate::codegen::types::{
    derive_dependencies, escape_py_single, escape_xml, python_param_literal, python_qos_expr,
    sanitize_symbol_name, InterfaceParts,
};
use crate::model::{NodeOwnership, Package, PortKind, QosPreset, RosChannel, RosNode};
use minijinja::{context, Environment};
use std::collections::{BTreeMap, BTreeSet, HashMap};

const PACKAGE_XML_TEMPLATE: &str = r#"<?xml version="1.0"?>
<?xml-model href="http://download.ros.org/schema/package_format3.xsd" schematypens="http://www.w3.org/2001/XMLSchema"?>
<package format="3">
  <name>{{ name }}</name>
  <version>{{ version }}</version>
  <description>{{ description }}</description>
  <maintainer email="{{ maintainer_email }}">{{ maintainer_name }}</maintainer>
  <license>{{ license }}</license>
{% for dep in deps %}
  <depend>{{ dep }}</depend>
{% endfor %}
  <export>
    <build_type>ament_python</build_type>
  </export>
</package>
"#;

const SETUP_PY_TEMPLATE: &str = r#"from glob import glob
import os
from setuptools import find_packages, setup

package_name = '{{ name }}'

setup(
    name=package_name,
    version='{{ version }}',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages', ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        (os.path.join('share', package_name, 'launch'), glob('launch/*.launch.py')),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='{{ maintainer_name }}',
    maintainer_email='{{ maintainer_email }}',
    description='{{ description }}',
    license='{{ license }}',
    entry_points={
        'console_scripts': [
{% for script in console_scripts %}            '{{ script }}',
{% endfor %}        ],
    },
)
"#;

const SETUP_CFG_TEMPLATE: &str = r#"[develop]
script_dir=$base/lib/{{ name }}
[install]
install_scripts=$base/lib/{{ name }}
"#;

#[derive(Debug, Clone)]
pub struct GeneratedUnit {
    /// Path relative to `<workspace>/`, using forward slashes, e.g. `src/py_pubsub/package.xml`
    pub rel_path: String,
    pub package_id: String,
    pub node_id: Option<String>,
    pub comment_style: Option<CommentStyle>,
    pub content: String,
}

fn render_template(source: &str, ctx: minijinja::Value) -> String {
    let mut env = Environment::new();
    env.add_template("tpl", source).expect("valid template");
    let mut rendered = env
        .get_template("tpl")
        .expect("template exists")
        .render(ctx)
        .expect("template render succeeds");
    if !rendered.ends_with('\n') {
        rendered.push('\n');
    }
    rendered
}

/// Generates all files for an `ament_python` package (F1.23, F1.25, F1.26, F1.27, F1.29, F1.30).
pub fn generate_python_package(
    pkg: &Package,
    channels: &HashMap<&str, &RosChannel>,
) -> Vec<GeneratedUnit> {
    let mut units = Vec::new();
    let prefix = format!("src/{}", pkg.name);
    let deps = derive_dependencies(pkg, channels);

    let description = if pkg.description.trim().is_empty() {
        format!("ROS 2 Python package {}", pkg.name)
    } else {
        pkg.description.trim().to_string()
    };
    let maint_name = if pkg.maintainer.name.trim().is_empty() {
        "RosForge User"
    } else {
        pkg.maintainer.name.trim()
    };
    let maint_email = if pkg.maintainer.email.trim().is_empty() {
        "user@example.com"
    } else {
        pkg.maintainer.email.trim()
    };

    // 1. package.xml
    let package_xml = render_template(
        PACKAGE_XML_TEMPLATE,
        context! {
            name => escape_xml(&pkg.name),
            version => escape_xml(&pkg.version),
            description => escape_xml(&description),
            maintainer_name => escape_xml(maint_name),
            maintainer_email => escape_xml(maint_email),
            license => escape_xml(&pkg.license),
            deps => deps,
        },
    );
    units.push(GeneratedUnit {
        rel_path: format!("{prefix}/package.xml"),
        package_id: pkg.id.clone(),
        node_id: None,
        comment_style: None,
        content: package_xml,
    });

    // 2. setup.py
    let mut console_scripts: Vec<String> = pkg
        .nodes
        .iter()
        .map(|n| {
            let module = n
                .source_file
                .as_deref()
                .and_then(|sf| {
                    sf.rsplit('/')
                        .next()
                        .and_then(|f| f.strip_suffix(".py"))
                })
                .unwrap_or(&n.name);
            format!(
                "{} = {}.{}:main",
                escape_py_single(&n.executable),
                escape_py_single(&pkg.name),
                escape_py_single(module)
            )
        })
        .collect();
    console_scripts.sort();

    let setup_py = render_template(
        SETUP_PY_TEMPLATE,
        context! {
            name => escape_py_single(&pkg.name),
            version => escape_py_single(&pkg.version),
            maintainer_name => escape_py_single(maint_name),
            maintainer_email => escape_py_single(maint_email),
            description => escape_py_single(&description),
            license => escape_py_single(&pkg.license),
            console_scripts => console_scripts,
        },
    );
    units.push(GeneratedUnit {
        rel_path: format!("{prefix}/setup.py"),
        package_id: pkg.id.clone(),
        node_id: None,
        comment_style: None,
        content: setup_py,
    });

    // 3. setup.cfg
    let setup_cfg = render_template(SETUP_CFG_TEMPLATE, context! { name => &pkg.name });
    units.push(GeneratedUnit {
        rel_path: format!("{prefix}/setup.cfg"),
        package_id: pkg.id.clone(),
        node_id: None,
        comment_style: None,
        content: setup_cfg,
    });

    // 4. resource/<pkg>
    units.push(GeneratedUnit {
        rel_path: format!("{prefix}/resource/{}", pkg.name),
        package_id: pkg.id.clone(),
        node_id: None,
        comment_style: None,
        content: String::new(),
    });

    // 5. <pkg>/__init__.py
    units.push(GeneratedUnit {
        rel_path: format!("{prefix}/{}/__init__.py", pkg.name),
        package_id: pkg.id.clone(),
        node_id: None,
        comment_style: None,
        content: String::new(),
    });

    // 6. <pkg>/<node>.py for each generated node
    for node in &pkg.nodes {
        if node.ownership != NodeOwnership::Generated {
            continue;
        }
        let source = render_python_node(node, channels);
        units.push(GeneratedUnit {
            rel_path: format!("{prefix}/{}/{}.py", pkg.name, node.name),
            package_id: pkg.id.clone(),
            node_id: Some(node.id.clone()),
            comment_style: Some(CommentStyle::Hash),
            content: source,
        });
    }

    // 7. launch/*.launch.py
    for (rel_launch, content) in render_package_launch_files(pkg) {
        units.push(GeneratedUnit {
            rel_path: format!("{prefix}/{rel_launch}"),
            package_id: pkg.id.clone(),
            node_id: None,
            comment_style: None,
            content,
        });
    }

    units
}

fn render_python_node(node: &RosNode, channels: &HashMap<&str, &RosChannel>) -> String {
    let mut out = String::new();
    let style = CommentStyle::Hash;

    // Collect required ROS imports deterministically
    let mut has_action_server = false;
    let mut has_action_client = false;
    let mut qos_imports: BTreeSet<&'static str> = BTreeSet::new();
    let mut type_imports: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();

    // Assign deterministic, collision-free symbol suffixes for ports
    let mut sym_counts: HashMap<String, usize> = HashMap::new();
    struct ResolvedPort<'a> {
        id: &'a str,
        kind: PortKind,
        channel_name: &'a str,
        type_name: String,
        symbol: String,
        qos: &'a QosPreset,
    }

    let mut resolved_ports = Vec::new();
    for port in &node.ports {
        let Some(ch) = channels.get(port.channel_id.as_str()) else {
            continue;
        };
        let Some(parts) = InterfaceParts::parse(&ch.interface_type) else {
            continue;
        };

        type_imports
            .entry(parts.python_module())
            .or_default()
            .insert(parts.type_name.clone());

        match port.kind {
            PortKind::ActionServer => has_action_server = true,
            PortKind::ActionClient => has_action_client = true,
            PortKind::Pub | PortKind::Sub => match &port.qos {
                QosPreset::Default => {}
                QosPreset::SensorData => {
                    qos_imports.insert("qos_profile_sensor_data");
                }
                QosPreset::ServicesDefault => {
                    qos_imports.insert("qos_profile_services_default");
                }
                QosPreset::SystemDefault => {
                    qos_imports.insert("qos_profile_system_default");
                }
                QosPreset::Custom(_) => {
                    qos_imports.insert("QoSProfile");
                    qos_imports.insert("ReliabilityPolicy");
                    qos_imports.insert("DurabilityPolicy");
                    qos_imports.insert("HistoryPolicy");
                }
            },
            _ => {}
        }

        let kind_prefix = match port.kind {
            PortKind::Pub => "pub",
            PortKind::Sub => "sub",
            PortKind::SrvServer => "srv",
            PortKind::SrvClient => "cli",
            PortKind::ActionServer => "action_srv",
            PortKind::ActionClient => "action_cli",
        };
        let base = format!("{kind_prefix}_{}", sanitize_symbol_name(&ch.name));
        let count = sym_counts.entry(base.clone()).or_insert(0);
        *count += 1;
        let symbol = if *count == 1 {
            base
        } else {
            format!("{base}_{count}")
        };

        resolved_ports.push(ResolvedPort {
            id: port.id.as_str(),
            kind: port.kind,
            channel_name: ch.name.as_str(),
            type_name: parts.type_name,
            symbol,
            qos: &port.qos,
        });
    }

    // Standard imports
    out.push_str("import rclpy\n");
    out.push_str("from rclpy.node import Node\n");

    if has_action_server || has_action_client {
        let mut items = Vec::new();
        if has_action_client {
            items.push("ActionClient");
        }
        if has_action_server {
            items.push("ActionServer");
            items.push("CancelResponse");
            items.push("GoalResponse");
        }
        out.push_str(&format!("from rclpy.action import {}\n", items.join(", ")));
    }

    if !qos_imports.is_empty() {
        let list: Vec<&str> = qos_imports.into_iter().collect();
        out.push_str(&format!("from rclpy.qos import {}\n", list.join(", ")));
    }

    for (module, types) in &type_imports {
        let list: Vec<&str> = types.iter().map(String::as_str).collect();
        out.push_str(&format!("from {module} import {}\n", list.join(", ")));
    }

    out.push('\n');
    out.push_str(&start_marker(style, &format!("{}:imports", node.id)));
    out.push('\n');
    out.push_str(&end_marker(style, &format!("{}:imports", node.id)));
    out.push_str("\n\n\n");

    // Class definition
    out.push_str(&format!("class {}(Node):\n", node.class_name));
    out.push_str("    def __init__(self):\n");
    out.push_str(&format!(
        "        super().__init__('{}')\n",
        escape_py_single(&node.name)
    ));

    // Parameters
    if !node.params.is_empty() {
        out.push('\n');
        for param in &node.params {
            out.push_str(&format!(
                "        self.declare_parameter('{}', {})\n",
                escape_py_single(&param.name),
                python_param_literal(&param.default)
            ));
        }
    }

    // Ports
    if !resolved_ports.is_empty() {
        out.push('\n');
        for rp in &resolved_ports {
            match rp.kind {
                PortKind::Pub => {
                    out.push_str(&format!(
                        "        self.{} = self.create_publisher({}, '{}', {})\n",
                        rp.symbol,
                        rp.type_name,
                        escape_py_single(rp.channel_name),
                        python_qos_expr(rp.qos)
                    ));
                }
                PortKind::Sub => {
                    out.push_str(&format!(
                        "        self.{} = self.create_subscription({}, '{}', self.on_{}, {})\n",
                        rp.symbol,
                        rp.type_name,
                        escape_py_single(rp.channel_name),
                        rp.symbol,
                        python_qos_expr(rp.qos)
                    ));
                }
                PortKind::SrvServer => {
                    out.push_str(&format!(
                        "        self.{} = self.create_service({}, '{}', self.on_{})\n",
                        rp.symbol,
                        rp.type_name,
                        escape_py_single(rp.channel_name),
                        rp.symbol
                    ));
                }
                PortKind::SrvClient => {
                    out.push_str(&format!(
                        "        self.{} = self.create_client({}, '{}')\n",
                        rp.symbol,
                        rp.type_name,
                        escape_py_single(rp.channel_name)
                    ));
                }
                PortKind::ActionServer => {
                    out.push_str(&format!(
                        "        self.{} = ActionServer(\n            self,\n            {},\n            '{}',\n            execute_callback=self.on_{}_execute,\n            goal_callback=self.on_{}_goal,\n            cancel_callback=self.on_{}_cancel,\n        )\n",
                        rp.symbol,
                        rp.type_name,
                        escape_py_single(rp.channel_name),
                        rp.symbol,
                        rp.symbol,
                        rp.symbol
                    ));
                }
                PortKind::ActionClient => {
                    out.push_str(&format!(
                        "        self.{} = ActionClient(self, {}, '{}')\n",
                        rp.symbol,
                        rp.type_name,
                        escape_py_single(rp.channel_name)
                    ));
                }
            }
        }
    }

    // Timers
    if !node.timers.is_empty() {
        out.push('\n');
        for timer in &node.timers {
            let period_sec = (timer.period_ms as f64) / 1000.0;
            out.push_str(&format!(
                "        self.timer_{} = self.create_timer({period_sec}, self.on_timer_{})\n",
                timer.name, timer.name
            ));
        }
    }

    // Init user region
    out.push('\n');
    out.push_str(&format!(
        "        {}\n",
        start_marker(style, &format!("{}:init", node.id))
    ));
    out.push_str(&format!(
        "        self.get_logger().info('Node {} initialized')\n",
        escape_py_single(&node.name)
    ));
    out.push_str(&format!(
        "        {}\n",
        end_marker(style, &format!("{}:init", node.id))
    ));

    // Callbacks for ports
    for rp in &resolved_ports {
        match rp.kind {
            PortKind::Sub => {
                out.push_str(&format!("\n    def on_{}(self, msg):\n", rp.symbol));
                out.push_str(&format!("        {}\n", start_marker(style, rp.id)));
                out.push_str(&format!(
                    "        self.get_logger().info(f'TODO: handle {} -> {{msg}}')\n",
                    escape_py_single(rp.channel_name)
                ));
                out.push_str(&format!("        {}\n", end_marker(style, rp.id)));
            }
            PortKind::SrvServer => {
                out.push_str(&format!(
                    "\n    def on_{}(self, request, response):\n",
                    rp.symbol
                ));
                out.push_str(&format!("        {}\n", start_marker(style, rp.id)));
                out.push_str(&format!(
                    "        self.get_logger().info(f'TODO: handle service {} -> {{request}}')\n",
                    escape_py_single(rp.channel_name)
                ));
                out.push_str(&format!("        {}\n", end_marker(style, rp.id)));
                out.push_str("        return response\n");
            }
            PortKind::ActionServer => {
                out.push_str(&format!(
                    "\n    def on_{}_goal(self, goal_request):\n",
                    rp.symbol
                ));
                out.push_str(&format!(
                    "        {}\n",
                    start_marker(style, &format!("{}:goal", rp.id))
                ));
                out.push_str(&format!(
                    "        self.get_logger().info(f'TODO: evaluate goal on {} -> {{goal_request}}')\n",
                    escape_py_single(rp.channel_name)
                ));
                out.push_str("        return GoalResponse.ACCEPT\n");
                out.push_str(&format!(
                    "        {}\n",
                    end_marker(style, &format!("{}:goal", rp.id))
                ));

                out.push_str(&format!(
                    "\n    def on_{}_cancel(self, goal_handle):\n",
                    rp.symbol
                ));
                out.push_str(&format!(
                    "        {}\n",
                    start_marker(style, &format!("{}:cancel", rp.id))
                ));
                out.push_str(&format!(
                    "        self.get_logger().info('TODO: handle cancel on {}')\n",
                    escape_py_single(rp.channel_name)
                ));
                out.push_str("        return CancelResponse.ACCEPT\n");
                out.push_str(&format!(
                    "        {}\n",
                    end_marker(style, &format!("{}:cancel", rp.id))
                ));

                out.push_str(&format!(
                    "\n    def on_{}_execute(self, goal_handle):\n",
                    rp.symbol
                ));
                out.push_str(&format!("        result = {}.Result()\n", rp.type_name));
                out.push_str(&format!("        {}\n", start_marker(style, rp.id)));
                out.push_str(&format!(
                    "        self.get_logger().info('TODO: execute action {}')\n",
                    escape_py_single(rp.channel_name)
                ));
                out.push_str("        goal_handle.succeed()\n");
                out.push_str(&format!("        {}\n", end_marker(style, rp.id)));
                out.push_str("        return result\n");
            }
            PortKind::Pub | PortKind::SrvClient | PortKind::ActionClient => {}
        }
    }

    // Callbacks for timers
    for timer in &node.timers {
        out.push_str(&format!("\n    def on_timer_{}(self):\n", timer.name));
        out.push_str(&format!("        {}\n", start_marker(style, &timer.id)));
        out.push_str(&format!(
            "        self.get_logger().info('TODO: timer {} tick')\n",
            escape_py_single(&timer.name)
        ));
        out.push_str(&format!("        {}\n", end_marker(style, &timer.id)));
    }

    // Main entrypoint
    out.push_str("\n\ndef main(args=None):\n");
    out.push_str("    rclpy.init(args=args)\n");
    out.push_str(&format!("    node = {}()\n", node.class_name));
    out.push_str("    try:\n");
    out.push_str("        rclpy.spin(node)\n");
    out.push_str("    except KeyboardInterrupt:\n");
    out.push_str("        pass\n");
    out.push_str("    finally:\n");
    out.push_str("        node.destroy_node()\n");
    out.push_str("        rclpy.try_shutdown()\n");
    out.push_str("\n\nif __name__ == '__main__':\n");
    out.push_str("    main()\n");

    out
}
