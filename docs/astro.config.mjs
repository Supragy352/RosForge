import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://Supragy352.github.io',
  base: '/RosForge',
  integrations: [
    starlight({
      title: 'RosForge',
      description:
        'Visual ROS 2 Jazzy node-graph IDE with deterministic Python & C++ code generation',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/Supragy352/RosForge',
        },
      ],
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        {
          label: 'Guides',
          items: [
            { label: 'Getting Started', slug: 'guides/getting-started' },
            { label: 'Feature Walkthrough', slug: 'guides/features' },
          ],
        },
        {
          label: 'Tutorials',
          items: [
            { label: 'Simple Pub-Sub Example', slug: 'tutorials/pubsub' },
          ],
        },
      ],
    }),
  ],
});
