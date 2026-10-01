import { defineConfig } from 'vite'
import { srcBin } from '../../vite.config.ts'

// The `browse` executable build: one ESM file and no declarations, because an executable ships no
// types. Rolldown strips a source shebang while bundling, so `output.banner` writes it back, and
// `output.paths` rewrites the externalized `@src/*` specifiers to the built sibling environments
// relative to `dist/bin/`, so the emitted entry resolves at runtime.
export default defineConfig(
	srcBin({
		build: {
			rolldownOptions: {
				output: {
					banner: '#!/usr/bin/env node',
					paths: {
						'@src/core': '../src/core/index.js',
						'@src/server': '../src/server/index.js',
					},
				},
			},
		},
	}),
)
