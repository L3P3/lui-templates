import {
	NODE_TYPE_ELEMENT,
	VALUE_TYPE_FIELD,
	VALUE_TYPE_STATIC,
	VALUE_TYPE_STRING_CONCAT,
} from './constants.js';

export function generate(name, parsed, lui_imports) {
	name = name_format(name);
	const {effects, inputs, transformations} = parsed;
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
		body.push('return [null];');
	}

	return `function ${name}(${
		inputs_generate(inputs)
	}) {\n\t${
		body.join('\n\n\t')
	}\n}`;
}

/**
	formats name for a component
	@param {string} name some-name
	@returns {string} SomeName
*/
function name_format(name) {
	name =
		name.charAt(0).toUpperCase() +
		name.slice(1).replace(
			/-([a-z])/g,
			(_, char) => char.toUpperCase()
		);
	assert_identifier(name);
	return name;
}

function inputs_generate(inputs) {
	if (inputs.length === 0) return '';

	const declarations = inputs.map(input => {
		assert_identifier(input.name);
		if (input.fallback !== undefined) {
			return `${input.name} = ${JSON.stringify(input.fallback)}`;
		}
		return input.name;
	});

	return `{${list_generate(declarations, 0)}}`;
}

function descriptor_generate(node) {
	if (node.tag.includes('[')) throw new SyntaxError(`Tag must not contain "[": ${node.tag}`);
	const attributes = Object.entries(node.attrs)
		.filter(entry => entry[1].type === VALUE_TYPE_STATIC)
		.map(descriptor_attribute_generate)
		.filter(Boolean);
	if (attributes.length === 0) return node.tag;
	const invalid = attributes.find(attribute => attribute.includes(']['));
	if (invalid) throw new SyntaxError(`Static attributes must not contain "][": ${invalid}`);
	return `${node.tag}[${attributes.sort().join('][')}]`;
}

function descriptor_attribute_generate([key, value]) {
	assert_identifier(key);
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
	for (const entry of entries) assert_identifier(entry[0]);
	const assignments = entries.map(entry => `${entry[0]}: ${value_generate(entry[1], identation)}`);
	return `, {${list_generate(assignments, identation)}}`;
}

function value_generate(value, identation) {
	switch (value.type) {
	case VALUE_TYPE_STATIC: return JSON.stringify(value.data);
	case VALUE_TYPE_FIELD:
		assert_identifier(value.data);
		return value.data;
	case VALUE_TYPE_STRING_CONCAT: return string_concat_generate(value.data, identation);
	}
	throw new TypeError(`Unknown value type: ${value.type}`);
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
			case VALUE_TYPE_FIELD:
				assert_identifier(item.data);
				return `\${${item.data}}`;
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
	Throws an error if the string is not a valid JavaScript identifier
	@param {string} string
	@throws {SyntaxError} if the string is not a valid JavaScript
*/
function assert_identifier(string) {
	if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(string)) {
		throw new SyntaxError(`Invalid identifier: ${string}`);
	}
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
