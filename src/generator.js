import {
	NODE_TYPE_ELEMENT,
	VALUE_TYPE_FIELD,
	VALUE_TYPE_STATIC,
	VALUE_TYPE_STRING_CONCAT,
} from './constants.js';

export function generate(name, parsed, lui_imports) {
	const {inputs, transformations, effects} = parsed;
	let {nodes} = parsed;

	const body = [];

	// TODO: transformations

	if (nodes.length === 1 && nodes[0].type === NODE_TYPE_ELEMENT) {
		const [node] = nodes;
		lui_imports.add('hook_dom');
		body.push(`hook_dom("${
			descriptor_generate(node)
		}"${
			attrs_generate(Object.entries(node.attrs), 1)
		});`);
		nodes = node.children;
	}

	// TODO: effects

	if (nodes.length === 0) {
		body.push('return null;');
	} else {
		// TODO: implement
		body.push('return [];');
	}

	return `function ${
		name_generate(name)
	}(${
		inputs_generate(inputs)
	}) {\n\t${
		body.join('\n\n\t')
	}\n}`;
}

/**
	some-name -> SomeName
*/
function name_generate(name) {
	return (
		name.charAt(0).toUpperCase() +
		name.slice(1).replace(
			/-([a-z])/g,
			(_, char) => char.toUpperCase()
		)
	);
}

function inputs_generate(inputs) {
	if (inputs.length === 0) return '';

	const declarations = inputs.map(input => {
		if (input.fallback !== undefined) {
			return `${input.name} = ${JSON.stringify(input.fallback)}`;
		}
		return input.name;
	});

	return `{${list_generate(declarations, 0)}}`;
}

function descriptor_generate(node) {
	const attributes = Object.entries(node.attrs)
		.filter(entry => entry[1].type === VALUE_TYPE_STATIC)
		.map(descriptor_attribute_generate)
		.filter(Boolean);
	if (attributes.length === 0) return node.tag;
	return `${node.tag}[${attributes.sort().join('][')}]`;
}

function descriptor_attribute_generate([key, value]) {
	if (value.data === false) return '';
	if (value.data === true) return key;
	return `${key}=${string_escape(value.data)}`;
}

function attrs_generate(entries, identation) {
	return props_generate(
		entries.filter(entry => entry[1].type !== VALUE_TYPE_STATIC),
		identation
	);
}

function props_generate(entries, identation) {
	if (entries.length === 0) return '';
	const assignments = entries.map(attr => `${attr[0]}: ${value_generate(attr[1], identation)}`);
	return `, {${list_generate(assignments, identation)}}`;
}

function value_generate(value, identation) {
	switch (value.type) {
	case VALUE_TYPE_STATIC: return JSON.stringify(value.data);
	case VALUE_TYPE_FIELD: return value.data;
	case VALUE_TYPE_STRING_CONCAT: return string_concat_generate(value.data, identation);
	}
	return 'null';
}

function string_concat_generate(data, identation) {
	identation++;
	if (data.length === 2) {
		return data.map(item =>
			item.type === VALUE_TYPE_STATIC
			?	JSON.stringify(item.data)
			:	value_generate(item, identation)
		).join(' + ');
	}
	return `\`${
		data.map(item => {
			switch (item.type) {
			case VALUE_TYPE_STATIC: return template_escape(item.data);
			case VALUE_TYPE_FIELD: return `\${${item.data}}`;
			}
			return `\${\n\t${
				'\t'.repeat(identation) +
				value_generate(item, identation)
			}\n${'\t'.repeat(identation)}}`;
		}).join('')
	}\``;
}

function template_escape(string) {
	return (
		String(string)
		.replaceAll('\\', '\\\\')
		.replaceAll('`', '\\`')
		.replaceAll('$', '\\$')
	);
}

function string_escape(string) {
	return (
		String(string)
		.replaceAll('\\', '\\\\')
		.replaceAll('"', '\\"')
		.replaceAll('\n', '\\n')
	);
}

/**
	if a list entry contains one of these characters, it must be put on its own line
*/
const regexp_noinline = /[\n:{[]/;

/**
	formats an object/array content, braces/brackets not included
	@param {string[]} entries
	@param {number} identation
	@return {string}
*/
export function list_generate(entries, identation) {
	switch (entries.length) {
	case 0: return '';
	case 1:	if (!regexp_noinline.test(entries[0])) return ` ${entries[0]} `;
	}
	identation = '\t'.repeat(identation);
	return `\n\t${identation + entries.sort().join(',\n\t' + identation)},\n` + identation;
}
