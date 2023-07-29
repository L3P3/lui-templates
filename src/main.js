import {
	readdir,
	stat,
} from 'fs/promises';

import {
	generate,
	list_generate,
} from './generator.js';
import {parse} from './parser.js';

export default async function lui_templates(path, lui_name = 'lui') {
	const is_directory = (await stat(path)).isDirectory();

	const paths = is_directory
	?	(await readdir(path)).map(name => `${path}/${name}`)
	:	[path];

	const all_parsed = await Promise.all(paths.map(parse));

	const lui_imports = new Set();
	const result = [];

	for (const [name, parsed] of all_parsed) {
		const expression = generate(name, parsed, lui_imports);

		result.push(
			'export ' +
			(is_directory ? '' : 'default ') +
			expression
		);
	}

	// write lui_imports to the top of the file
	result.unshift(`import {${
		list_generate([...lui_imports], 0)
	}} from ${JSON.stringify(lui_name)};`);

	result.unshift('// generated by lui-templates')

	return result.join('\n\n') + '\n';
}