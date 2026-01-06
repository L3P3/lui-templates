#!/usr/bin/env node

import {
	readFileSync,
} from 'fs';

import lui_templates from './main.js';

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
	console.error(`Usage: lui-templates input [options]
Input: The template file or directory containing the templates
Options:
  -e, --externs <path>    File unknown components are imported from
  -h, --help              Show this help message
  --version               Show version information

Example:
  lui-templates ./templates/button.liquid > ./components/button.js
`);
	process.exit(0);
}
if (args[0] === '--version') {
	const { version } = JSON.parse(
		readFileSync(
			new URL('../package.json', import.meta.url)
		)
	);
	console.error(`lui-templates version ${version}`);
	process.exit(0);
}

if (args[0].startsWith('-')) {
	console.error('Must first specify the input, see --help');
	process.exit(1);
}

const path = args.shift();
let arg_externs = './externs.js';

while (args.length > 0) {
	const arg = args.shift();
	switch (arg) {
		case '-e':
		case '--externs':
			arg_externs = args.shift();
			break;
		default:
			console.error(`Unknown argument: ${arg}, see --help`);
			process.exit(1);
	}
}

const result = await lui_templates(path, {
	components_name: arg_externs,
});

console.log(result);
