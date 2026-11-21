use crate::codegen::launch::render_package_launch_files;
use crate::codegen::python::GeneratedUnit;
use crate::codegen::regions::{end_marker, start_marker, CommentStyle};
use crate::codegen::types::{
    cpp_param_type_and_literal, cpp_qos_expr, derive_cmake_build_dependencies, derive_dependencies,
    escape_cpp, escape_xml, sanitize_symbol_name, InterfaceParts,
};
use crate::model::{NodeOwnership, Package, PortKind, QosPreset, RosChannel, RosNode};
use minijinja::{context, Environment};
use std::collections::{BTreeSet, HashMap};

const CPP_PACKAGE_XML_TEMPLATE: &str = r#"<?xml version="1.0"?>
<?xml-model href="http://download.ros.org/schema/package_format3.xsd" schematypens="http://www.w3.org/2001/XMLSchema"?>
<package format="3">
  <name>{{ name }}</name>
  <version>{{ version }}</version>
  <description>{{ description }}</description>
  <maintainer email="{{ maintainer_email }}">{{ maintainer_name }}</maintainer>
  <license>{{ license }}</license>

  <buildtool_depend>ament_cmake</buildtool_depend>
{% for dep in deps %}
  <depend>{{ dep }}</depend>
{% endfor %}
  <export>
    <build_type>ament_cmake</build_type>
  </export>
</package>
"#;

const CMAKELISTS_TEMPLATE: &str = r#"cmake_minimum_required(VERSION 3.8)
project({{ name }})

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

find_package(ament_cmake REQUIRED)
{% for dep in cmake_deps %}find_package({{ dep }} REQUIRED)
{% endfor %}
{% for target in targets %}
add_executable({{ target.executable }} {{ target.source }})
target_compile_features({{ target.executable }} PUBLIC cxx_std_17)
ament_target_dependencies({{ target.executable }}
{% for dep in cmake_deps %}  {{ dep }}
{% endfor %})
{% endfor %}
{% if targets %}
install(TARGETS
{% for target in targets %}  {{ target.executable }}
{% endfor %}  DESTINATION lib/${PROJECT_NAME}
)
{% endif %}
install(DIRECTORY launch
  DESTINATION share/${PROJECT_NAME}
)

ament_package()
"#;

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

/// Generates all files for an `ament_cmake` C++ package (F1.24, F1.25, F1.26, F1.27, F1.29, F1.30).
pub fn generate_cpp_package(
    pkg: &Package,
    channels: &HashMap<&str, &RosChannel>,
) -> Vec<GeneratedUnit> {
    let mut units = Vec::new();
    let prefix = format!("src/{}", pkg.name);
    let deps = derive_dependencies(pkg, channels);
    let cmake_deps = derive_cmake_build_dependencies(pkg, channels);

    let description = if pkg.description.trim().is_empty() {
        format!("ROS 2 C++ package {}", pkg.name)
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
        CPP_PACKAGE_XML_TEMPLATE,
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

    // 2. CMakeLists.txt
    #[derive(serde::Serialize)]
    struct TargetSpec {
        executable: String,
        source: String,
    }
    let mut targets: Vec<TargetSpec> = pkg
        .nodes
        .iter()
        .map(|n| {
            let source = n
                .source_file
                .clone()
                .unwrap_or_else(|| format!("src/{}.cpp", n.name));
            TargetSpec {
                executable: n.executable.clone(),
                source,
            }
        })
        .collect();
    targets.sort_by(|a, b| a.executable.cmp(&b.executable));

    let cmakelists = render_template(
        CMAKELISTS_TEMPLATE,
        context! {
            name => &pkg.name,
            cmake_deps => cmake_deps,
            targets => targets,
        },
    );
    units.push(GeneratedUnit {
        rel_path: format!("{prefix}/CMakeLists.txt"),
        package_id: pkg.id.clone(),
        node_id: None,
        comment_style: None,
        content: cmakelists,
    });

    // 3. src/<node>.cpp for each generated node
    for node in &pkg.nodes {
        if node.ownership != NodeOwnership::Generated {
            continue;
        }
        let source = render_cpp_node(node, channels);
        units.push(GeneratedUnit {
            rel_path: format!("{prefix}/src/{}.cpp", node.name),
            package_id: pkg.id.clone(),
            node_id: Some(node.id.clone()),
            comment_style: Some(CommentStyle::Slash),
            content: source,
        });
    }

    // 4. launch/*.launch.py
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

fn render_cpp_node(node: &RosNode, channels: &HashMap<&str, &RosChannel>) -> String {
    let mut out = String::new();
    let style = CommentStyle::Slash;

    let mut has_action = false;
    let mut has_action_server = false;
    let mut interface_headers: BTreeSet<String> = BTreeSet::new();

    let mut sym_counts: HashMap<String, usize> = HashMap::new();
    struct ResolvedPort<'a> {
        id: &'a str,
        kind: PortKind,
        channel_name: &'a str,
        cpp_type: String,
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

        interface_headers.insert(parts.cpp_header());
        match port.kind {
            PortKind::ActionServer => {
                has_action = true;
                has_action_server = true;
            }
            PortKind::ActionClient => {
                has_action = true;
            }
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
            cpp_type: parts.cpp_type(),
            symbol,
            qos: &port.qos,
        });
    }

    // Standard includes
    out.push_str("#include <chrono>\n");
    out.push_str("#include <cstdint>\n");
    out.push_str("#include <memory>\n");
    out.push_str("#include <string>\n");
    if has_action_server {
        out.push_str("#include <thread>\n");
    }
    out.push_str("#include <vector>\n\n");
    out.push_str("#include \"rclcpp/rclcpp.hpp\"\n");
    if has_action {
        out.push_str("#include \"rclcpp_action/rclcpp_action.hpp\"\n");
    }
    for header in &interface_headers {
        out.push_str(&format!("#include \"{header}\"\n"));
    }

    out.push('\n');
    out.push_str(&start_marker(style, &format!("{}:includes", node.id)));
    out.push('\n');
    out.push_str(&end_marker(style, &format!("{}:includes", node.id)));
    out.push_str("\n\n");

    // Class declaration
    out.push_str(&format!(
        "class {} : public rclcpp::Node {{\n",
        node.class_name
    ));
    out.push_str("public:\n");
    out.push_str(&format!(
        "  {}()\n  : Node(\"{}\") {{\n",
        node.class_name,
        escape_cpp(&node.name)
    ));

    // Parameters
    if !node.params.is_empty() {
        for param in &node.params {
            let (cpp_ty, cpp_lit) = cpp_param_type_and_literal(&param.default);
            out.push_str(&format!(
                "    this->declare_parameter<{cpp_ty}>(\"{}\", {cpp_lit});\n",
                escape_cpp(&param.name)
            ));
        }
        out.push('\n');
    }

    // Ports
    for rp in &resolved_ports {
        match rp.kind {
            PortKind::Pub => {
                out.push_str(&format!(
                    "    {}_ = this->create_publisher<{}>(\"{}\", {});\n",
                    rp.symbol,
                    rp.cpp_type,
                    escape_cpp(rp.channel_name),
                    cpp_qos_expr(rp.qos)
                ));
            }
            PortKind::Sub => {
                out.push_str(&format!(
                    "    {}_ = this->create_subscription<{}>(\n      \"{}\",\n      {},\n      [this](const {}::SharedPtr msg) {{ this->on_{}(msg); }});\n",
                    rp.symbol,
                    rp.cpp_type,
                    escape_cpp(rp.channel_name),
                    cpp_qos_expr(rp.qos),
                    rp.cpp_type,
                    rp.symbol
                ));
            }
            PortKind::SrvServer => {
                out.push_str(&format!(
                    "    {}_ = this->create_service<{}>(\n      \"{}\",\n      [this](\n        const std::shared_ptr<{}::Request> request,\n        std::shared_ptr<{}::Response> response) {{\n        this->on_{}(request, response);\n      }});\n",
                    rp.symbol,
                    rp.cpp_type,
                    escape_cpp(rp.channel_name),
                    rp.cpp_type,
                    rp.cpp_type,
                    rp.symbol
                ));
            }
            PortKind::SrvClient => {
                out.push_str(&format!(
                    "    {}_ = this->create_client<{}>(\"{}\");\n",
                    rp.symbol,
                    rp.cpp_type,
                    escape_cpp(rp.channel_name)
                ));
            }
            PortKind::ActionServer => {
                out.push_str(&format!(
                    "    {}_ = rclcpp_action::create_server<{}>(\n      this,\n      \"{}\",\n      [this](const rclcpp_action::GoalUUID & uuid, std::shared_ptr<const {}::Goal> goal) {{\n        return this->on_{}_goal(uuid, goal);\n      }},\n      [this](const std::shared_ptr<rclcpp_action::ServerGoalHandle<{}>> goal_handle) {{\n        return this->on_{}_cancel(goal_handle);\n      }},\n      [this](const std::shared_ptr<rclcpp_action::ServerGoalHandle<{}>> goal_handle) {{\n        std::thread([this, goal_handle]() {{ this->on_{}_execute(goal_handle); }}).detach();\n      }});\n",
                    rp.symbol,
                    rp.cpp_type,
                    escape_cpp(rp.channel_name),
                    rp.cpp_type,
                    rp.symbol,
                    rp.cpp_type,
                    rp.symbol,
                    rp.cpp_type,
                    rp.symbol
                ));
            }
            PortKind::ActionClient => {
                out.push_str(&format!(
                    "    {}_ = rclcpp_action::create_client<{}>(this, \"{}\");\n",
                    rp.symbol,
                    rp.cpp_type,
                    escape_cpp(rp.channel_name)
                ));
            }
        }
    }

    // Timers
    if !node.timers.is_empty() {
        out.push('\n');
        for timer in &node.timers {
            out.push_str(&format!(
                "    timer_{}_ = this->create_wall_timer(\n      std::chrono::milliseconds({}),\n      [this]() {{ this->on_timer_{}(); }});\n",
                timer.name, timer.period_ms, timer.name
            ));
        }
    }

    // Init user region
    out.push('\n');
    out.push_str(&format!(
        "    {}\n",
        start_marker(style, &format!("{}:init", node.id))
    ));
    out.push_str(&format!(
        "    RCLCPP_INFO(this->get_logger(), \"Node {} initialized\");\n",
        escape_cpp(&node.name)
    ));
    out.push_str(&format!(
        "    {}\n",
        end_marker(style, &format!("{}:init", node.id))
    ));
    out.push_str("  }\n\nprivate:\n");

    // Callback methods
    for rp in &resolved_ports {
        match rp.kind {
            PortKind::Sub => {
                out.push_str(&format!(
                    "  void on_{}(const {}::SharedPtr msg) {{\n",
                    rp.symbol, rp.cpp_type
                ));
                out.push_str("    (void)msg;\n");
                out.push_str(&format!("    {}\n", start_marker(style, rp.id)));
                out.push_str(&format!(
                    "    RCLCPP_INFO(this->get_logger(), \"TODO: handle {}\");\n",
                    escape_cpp(rp.channel_name)
                ));
                out.push_str(&format!("    {}\n", end_marker(style, rp.id)));
                out.push_str("  }\n\n");
            }
            PortKind::SrvServer => {
                out.push_str(&format!(
                    "  void on_{}(\n    const std::shared_ptr<{}::Request> request,\n    std::shared_ptr<{}::Response> response) {{\n",
                    rp.symbol, rp.cpp_type, rp.cpp_type
                ));
                out.push_str("    (void)request;\n");
                out.push_str("    (void)response;\n");
                out.push_str(&format!("    {}\n", start_marker(style, rp.id)));
                out.push_str(&format!(
                    "    RCLCPP_INFO(this->get_logger(), \"TODO: handle service {}\");\n",
                    escape_cpp(rp.channel_name)
                ));
                out.push_str(&format!("    {}\n", end_marker(style, rp.id)));
                out.push_str("  }\n\n");
            }
            PortKind::ActionServer => {
                out.push_str(&format!(
                    "  rclcpp_action::GoalResponse on_{}_goal(\n    const rclcpp_action::GoalUUID & uuid,\n    std::shared_ptr<const {}::Goal> goal) {{\n",
                    rp.symbol, rp.cpp_type
                ));
                out.push_str("    (void)uuid;\n");
                out.push_str("    (void)goal;\n");
                out.push_str(&format!(
                    "    {}\n",
                    start_marker(style, &format!("{}:goal", rp.id))
                ));
                out.push_str(&format!(
                    "    RCLCPP_INFO(this->get_logger(), \"TODO: evaluate goal on {}\");\n",
                    escape_cpp(rp.channel_name)
                ));
                out.push_str("    return rclcpp_action::GoalResponse::ACCEPT_AND_EXECUTE;\n");
                out.push_str(&format!(
                    "    {}\n",
                    end_marker(style, &format!("{}:goal", rp.id))
                ));
                out.push_str("  }\n\n");

                out.push_str(&format!(
                    "  rclcpp_action::CancelResponse on_{}_cancel(\n    const std::shared_ptr<rclcpp_action::ServerGoalHandle<{}>> goal_handle) {{\n",
                    rp.symbol, rp.cpp_type
                ));
                out.push_str("    (void)goal_handle;\n");
                out.push_str(&format!(
                    "    {}\n",
                    start_marker(style, &format!("{}:cancel", rp.id))
                ));
                out.push_str(&format!(
                    "    RCLCPP_INFO(this->get_logger(), \"TODO: handle cancel on {}\");\n",
                    escape_cpp(rp.channel_name)
                ));
                out.push_str("    return rclcpp_action::CancelResponse::ACCEPT;\n");
                out.push_str(&format!(
                    "    {}\n",
                    end_marker(style, &format!("{}:cancel", rp.id))
                ));
                out.push_str("  }\n\n");

                out.push_str(&format!(
                    "  void on_{}_execute(\n    const std::shared_ptr<rclcpp_action::ServerGoalHandle<{}>> goal_handle) {{\n",
                    rp.symbol, rp.cpp_type
                ));
                out.push_str(&format!(
                    "    auto result = std::make_shared<{}::Result>();\n",
                    rp.cpp_type
                ));
                out.push_str(&format!("    {}\n", start_marker(style, rp.id)));
                out.push_str(&format!(
                    "    RCLCPP_INFO(this->get_logger(), \"TODO: execute action {}\");\n",
                    escape_cpp(rp.channel_name)
                ));
                out.push_str("    goal_handle->succeed(result);\n");
                out.push_str(&format!("    {}\n", end_marker(style, rp.id)));
                out.push_str("  }\n\n");
            }
            PortKind::Pub | PortKind::SrvClient | PortKind::ActionClient => {}
        }
    }

    for timer in &node.timers {
        out.push_str(&format!("  void on_timer_{}() {{\n", timer.name));
        out.push_str(&format!("    {}\n", start_marker(style, &timer.id)));
        out.push_str(&format!(
            "    RCLCPP_INFO(this->get_logger(), \"TODO: timer {} tick\");\n",
            escape_cpp(&timer.name)
        ));
        out.push_str(&format!("    {}\n", end_marker(style, &timer.id)));
        out.push_str("  }\n\n");
    }

    // Member declarations
    for rp in &resolved_ports {
        let decl = match rp.kind {
            PortKind::Pub => format!("rclcpp::Publisher<{}>::SharedPtr {}_;", rp.cpp_type, rp.symbol),
            PortKind::Sub => {
                format!("rclcpp::Subscription<{}>::SharedPtr {}_;", rp.cpp_type, rp.symbol)
            }
            PortKind::SrvServer => {
                format!("rclcpp::Service<{}>::SharedPtr {}_;", rp.cpp_type, rp.symbol)
            }
            PortKind::SrvClient => {
                format!("rclcpp::Client<{}>::SharedPtr {}_;", rp.cpp_type, rp.symbol)
            }
            PortKind::ActionServer => format!(
                "rclcpp_action::Server<{}>::SharedPtr {}_;",
                rp.cpp_type, rp.symbol
            ),
            PortKind::ActionClient => format!(
                "rclcpp_action::Client<{}>::SharedPtr {}_;",
                rp.cpp_type, rp.symbol
            ),
        };
        out.push_str(&format!("  {decl}\n"));
    }

    for timer in &node.timers {
        out.push_str(&format!(
            "  rclcpp::TimerBase::SharedPtr timer_{}_;\n",
            timer.name
        ));
    }

    out.push('\n');
    out.push_str(&format!(
        "  {}\n",
        start_marker(style, &format!("{}:members", node.id))
    ));
    out.push_str(&format!(
        "  {}\n",
        end_marker(style, &format!("{}:members", node.id))
    ));
    out.push_str("};\n\n");

    // main()
    out.push_str("int main(int argc, char ** argv) {\n");
    out.push_str("  rclcpp::init(argc, argv);\n");
    out.push_str(&format!(
        "  rclcpp::spin(std::make_shared<{}>());\n",
        node.class_name
    ));
    out.push_str("  rclcpp::shutdown();\n");
    out.push_str("  return 0;\n");
    out.push_str("}\n");

    out
}
