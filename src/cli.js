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
  -g, --global            Assume window.lui is defined
  -h, --help              Show this help message
  --ssr '{"prop": ...}'   Render to html using lui-ssr (must be installed)
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
let arg_global = false;
let arg_ssr = null;

while (args.length > 0) {
	const arg = args.shift();
	switch (arg) {
		case '-e':
		case '--externs':
			arg_externs = args.shift();
			break;
		case '--ssr':
			arg_ssr = JSON.parse(args.shift());
		case '-g':
		case '--global':
			arg_global = true;
			break;
		default:
			console.error(`Unknown argument: ${arg}, see --help`);
			process.exit(1);
	}
}

let result = await lui_templates(path, {
	components_name: arg_externs,
	lui_global: arg_global,
});

if (arg_ssr) {
	const {default: lui_ssr} = await import('lui-ssr');
	const name = result.match(/function\s+(\w+)\s*\(/)?.[1];

	result += `
lui.init(() => {
	return [
		lui.node(${name}, ${JSON.stringify(arg_ssr)}),
	];
});`;

	result = lui_ssr(result)();
}

console.log(result);
