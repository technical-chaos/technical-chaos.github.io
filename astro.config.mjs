// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';

// https://astro.build/config
export default defineConfig({
	site: 'https://technical-chaos.github.io',
	integrations: [
		starlight({
			title: 'Technical Chaos',
			description: 'Notes from running a homelab with AI agents, Terraform and Ansible.',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/technical-chaos' }],
			// Fails the build on a broken internal link.
			plugins: [starlightLinksValidator()],
			sidebar: [
				{
					label: 'Homelab automation',
					items: [{ autogenerate: { directory: 'homelab-automation' } }],
				},
				{
					label: 'Video guides',
					items: [{ autogenerate: { directory: 'video-guides' } }],
				},
			],
		}),
	],
});
