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

const html_attr_to_dom_map = new Map([
	['class', 'className'],
	['for', 'htmlFor'],
	['tabindex', 'tabIndex'],
	['readonly', 'readOnly'],
	['maxlength', 'maxLength'],
	['cellspacing', 'cellSpacing'],
	['cellpadding', 'cellPadding'],
	['rowspan', 'rowSpan'],
	['colspan', 'colSpan'],
	['usemap', 'useMap'],
	['frameborder', 'frameBorder'],
	['contenteditable', 'contentEditable'],
]);
export function html_attr_to_dom(attr) {
	attr = attr.toLowerCase();
	return html_attr_to_dom_map.get(attr) || attr;
}

const html_whitespaces = ' \n\r\t\f\v'.split('');
export const html_is_whitespace = char => html_whitespaces.includes(char);

const html_self_closing = 'img,input,br,hr'.split(',');
export const html_is_self_closing = tag => html_self_closing.includes(tag);

const html_boolean_attrs = new Set('disabled,checked,selected,readonly,required,autofocus,autoplay,controls,loop,muted,open,hidden,multiple,defer,async,novalidate,formnovalidate'.split(','));
export const html_is_boolean_attr = attr => html_boolean_attrs.has(attr.toLowerCase());
