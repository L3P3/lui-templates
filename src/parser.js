import fs from 'fs/promises';

import {name_format} from './generator.js';

const parsers = new Map();

export async function parse(path) {
	const src_promise = fs.readFile(path, 'utf8');

	let name = path.split('/').pop().split('.');
	const extension = name.pop();
	name = name.join('.');

	let parser = parsers.get(extension);
	if (!parser) {
		try {
			parser = (await import(`./parsers/${extension}.js`)).default;
		} catch (e) {
			throw new Error(`No parser found for extension: ${extension}`);
		}

		parsers.set(extension, parser);
	}

	return [
		name_format(name),
		await parser(await src_promise, path),
	];
}
