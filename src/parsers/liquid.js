import {
	NODE_TYPE_ELEMENT,
	NODE_TYPE_IF,
	VALUE_TYPE_FIELD,
	VALUE_TYPE_STATIC,
	VALUE_TYPE_STRING_CONCAT,
} from '../constants.js';
import {
	html_attr_to_dom,
	html_is_self_closing,
	html_is_whitespace,
} from '../parser.js';

const TOKEN_HTML_START = 0; // html start tag
const TOKEN_HTML_END = 1; // html end tag
const TOKEN_TEXT = 2; // static text
const TOKEN_ATTRIBUTE = 3; // html attribute
const TOKEN_EXPRESSION = 4; // (inline transformed) variable
const TOKEN_LIQUID = 5; // generic liquid tag with one of the following commands

const COMMAND_NOP = 0;
const COMMAND_IF = 1;
const COMMAND_UNLESS = 2;
const COMMAND_FOR = 3;
const COMMAND_ENDIF = 4;
const COMMAND_ENDUNLESS = 5;
const COMMAND_ENDFOR = 6;

const command_map = new Map([
	['if', COMMAND_IF],
	['unless', COMMAND_UNLESS],
	['for', COMMAND_FOR],
	['endif', COMMAND_ENDIF],
	['endunless', COMMAND_ENDUNLESS],
	['endfor', COMMAND_ENDFOR],
]);
const command_map_reverse = new Map(
	Array.from(command_map.entries())
	.map(([key, value]) => [value, key])
);

export default async function parse_liquid(src, path) {
	const tokenizer = new Tokenizer(src, path);
	const tokens = tokenizer.parse_nodes();
	const nodes = build_nodes(tokens, 0, tokens.length);

	return {
		inputs: (
			Array.from(tokenizer.variables)
			// variables that are not assigned anywhere
			.filter(([, value]) => value === null)
			.map(([name]) => ({ name }))
		),

		// what variables are derived from other variables via transformations?
		transformations: [],// TODO
		// not used for now
		effects: [],
		nodes,
	};
}

/**
	To parse liquid, we first need to "tokenize" the input string into meaningful chunks.
	Reason for this is that we can have computed values, if and unless at almost any place.
	Our internal tree should consist of html start tags, html end tags, static text, html attributes, (inline transformed) variables, if nodes, loop nodes, and other liquid nodes.
	Then, we can traverse this tree to optimize it and generate the final output.
	Certain html elements are forbidden: script, style, link, noscript, etc.
	For clarity, no RegExp are used in this file and stuff related to html spec belongs to parser.js.
*/

/**
	Handles errors during of after tokenization.
	@param {string} message
	@param {Object} obj either the Tokenizer or a specific token
*/
function error(message, obj) {
	console.error(`Error in ${obj.path}:${obj.line}:${obj.column}: ${message}`);
	process.exit(1);
}

class Tokenizer {
	constructor(src, path) {
		this.src = src;
		this.path = path;
		this.line = 1;
		this.column = 0;
		this.index = 0;
		this.variables = new Map;
	}

	/**
		Returns the current character being processed.
	*/
	char_current() {
		return this.src.charAt(this.index);
	}

	/**
		Checks if the next characters match the given string.
		@param {string} chars
		@returns {boolean}
	*/
	chars_match(chars) {
		return this.src.slice(this.index, this.index + chars.length) === chars;
	}

	/**
		Steps to the next character.
	*/
	char_step() {
		const char = this.char_current();
		if (char == null) error('Unexpected end of input', this);
		this.index++;
		if (char === '\n') {
			this.line++;
			this.column = 0;
		}
		else this.column++;
	}

	/**
		Steps over n characters.
		@param {number} n
	*/
	chars_step(n) {
		for (let i = 0; i < n; i++) {
			this.char_step();
		}
	}

	/**
		Consumes the given characters from the input.
		@param {string} chars
	*/
	chars_consume(chars) {
		if (!this.chars_match(chars)) error(`Expected "${chars}"`, this);
		this.chars_step(chars.length);
	}

	/**
		Consumes characters until the given limit is reached.
		@param {string} limit - The end delimiter
		@param {string} desc - Description of the context
	*/
	chars_consume_until(limit, desc) {
		const index_end = this.src.indexOf(limit, this.index);
		if (index_end === -1) error(`Unclosed ${desc}`, this);
		const value = this.src.slice(this.index, index_end);
		this.chars_step(index_end + limit.length - this.index);
		return value;
	}

	/**
		Skips whitespace characters.
	*/
	chars_skip_whitespace() {
		while (html_is_whitespace(this.char_current())) {
			this.char_step();
		}
	}

	/**
		Creates position info for a token.
		@returns {Object} Position info with path, line, column
	*/
	position_get() {
		return {
			path: this.path,
			line: this.line,
			column: this.column,
		};
	}

	/**
		Expects to be in either top level or inside a block.
		@returns {Array} Array of tokens
	*/
	parse_nodes() {
		const tokens = [];

		while (this.index < this.src.length) {
			let token = null;

			const char = this.char_current();
			if (html_is_whitespace(char)) {
				this.char_step();
			}
			else if (char === '<') {
				if (this.chars_match('<!--')) this.chars_consume_until('-->', 'HTML comment');
				else if (this.chars_match('</')) token = this.parse_html_end();
				else token = this.parse_html_start();
			}
			else if (char === '{') {
				token = this.parse_liquid();
			}
			else {
				token = this.parse_text();
			}

			if (token !== null) tokens.push(token);
		}

		return tokens;
	}

	/**
		Parses a html start tag.
		@returns {Object} Token
	*/
	parse_html_start() {
		const position = this.position_get();
		this.chars_consume('<');
		const tag_name = this.parse_tag_name();
		const attributes = this.parse_attributes();
		this.chars_consume('>');

		return {
			type: TOKEN_HTML_START,
			...position,
			trim_before: false,
			trim_after: false,
			tag_name,
			attributes,
		};
	}

	/**
		Parses an html end tag.
		@returns {Object} Token
	*/
	parse_html_end() {
		const position = this.position_get();
		this.chars_consume('</');
		const tag_name = this.parse_tag_name();
		this.chars_consume('>');

		return {
			type: TOKEN_HTML_END,
			...position,
			trim_before: false,
			trim_after: false,
			tag_name,
		};
	}

	/**
		Parses a liquid block.
		@returns {Object} Token
	*/
	parse_liquid() {
		const position = this.position_get();
		const is_expression = this.chars_match('{{');

		if (
			!is_expression &&
			!this.chars_match('{%')
		) {
			// this is not a liquid tag!
			this.char_step();
			return {
				type: TOKEN_TEXT,
				...position,
				trim_before: false,
				trim_after: false,
				value: '{',
			};
		}

		this.chars_consume('{');
		this.char_step(); // skip second { or %

		let value = (
			is_expression
			?	this.chars_consume_until('}}', 'liquid expression')
			:	this.chars_consume_until('%}', 'liquid tag')
		);
		const trim_before = value.startsWith('-');
		const trim_after = value.endsWith('-');
		value = value.slice(
			trim_before ? 1 : 0,
			trim_after ? -1 : undefined
		).trim();

		if (is_expression) {
			// TODO: see if it is really just a variable or includes pipes
			this.variables.set(value, null);
			return {
				type: TOKEN_EXPRESSION,
				...position,
				trim_before,
				trim_after,
				value,
			};
		}

		// liquid tag
		const [command_str, ...args] = value.split(' ');
		if (!command_str) error('Empty liquid tag command', position);
		value = args.join(' ').trimStart();

		switch (command_str) {
		case 'comment':
			this.chars_consume_until('endcomment', 'liquid comment');
			return {
				type: TOKEN_LIQUID,
				...position,
				trim_before,
				trim_after: this.chars_consume_until('%}', 'liquid tag').endsWith('-'),
				command: COMMAND_NOP,
				value: '',
			};
		case 'echo':
			// TODO: see if it is really just a variable or includes pipes
			this.variables.set(value, null);
			return {
				type: TOKEN_EXPRESSION,
				...position,
				trim_before,
				trim_after,
				value,
			};
		case 'raw': {
			const position = this.position_get();
			let value = this.chars_consume_until('endraw', 'liquid raw');
			if (trim_after) value = value.trimStart();
			const index_end_braces = value.lastIndexOf('{%');
			if (index_end_braces === -1) error(`Unclosed liquid raw`, position);
			const trim_after_2 = value.charAt(index_end_braces + 2) === '-';
			value = value.slice(0, index_end_braces);
			if (trim_after_2) value = value.trimEnd();
			return {
				type: TOKEN_TEXT,
				...position,
				trim_before,
				trim_after: this.chars_consume_until('%}', 'liquid tag').endsWith('-'),
				value,
			};
		}
		}

		const command = command_map.get(command_str);
		if (command == null) error(`Unsupported liquid command: ${command_str}`, position);

		if (
			command === COMMAND_IF ||
			command === COMMAND_UNLESS
		) {
			// TODO: see if it is really just a variable or includes pipes
			this.variables.set(value, null);
		}

		return {
			type: TOKEN_LIQUID,
			...position,
			trim_before,
			trim_after,
			command,
			value,
		};
	}

	/**
		Parses static text value.
		@returns {Object} Token
	*/
	parse_text() {
		const position = this.position_get();
		let value = '';
		while (this.index < this.src.length) {
			const char = this.char_current();
			if (char === '<' || char === '{') break;
			value += char;
			this.char_step();
		}
		return {
			type: TOKEN_TEXT,
			...position,
			trim_before: false,
			trim_after: false,
			value,
		};
	}

	/**
		Parses a tag name (can be static or dynamic).
		@returns {string} Tag name
	*/
	parse_tag_name() {
		let name = '';
		while (this.index < this.src.length) {
			const char = this.char_current();
			if (html_is_whitespace(char) || char === '>' || char === '/') break;
			name += char;
			this.char_step();
		}
		return name;
	}

	/**
		Parses HTML attributes.
		@returns {Array} Array of attribute tokens
	*/
	parse_attributes() {
		const attributes = [];

		while (this.index < this.src.length) {
			// Skip whitespace
			while (html_is_whitespace(this.char_current())) {
				this.char_step();
			}

			const char = this.char_current();
			if (char === '>' || char === '/') break;

			// Check for liquid tag (including conditionals)
			if (char === '{' && this.chars_match('{%')) {
				const liquid_tag = this.parse_liquid();
				// Store liquid tag directly - it will be processed in build phase
				attributes.push(liquid_tag);
				continue;
			}

			const position = this.position_get();

			// Parse attribute name
			let name = '';
			while (this.index < this.src.length) {
				const c = this.char_current();
				if (html_is_whitespace(c) || c === '=' || c === '>' || c === '/' || c === '{') break;
				name += c;
				this.char_step();
			}

			if (!name) break;

			// Skip whitespace after name
			while (html_is_whitespace(this.char_current())) {
				this.char_step();
			}

			// Check for '='
			let value_tokens = null;
			if (this.char_current() === '=') {
				this.char_step();

				// Skip whitespace after '='
				while (html_is_whitespace(this.char_current())) {
					this.char_step();
				}

				// Parse attribute value
				const quote = this.char_current();
				if (quote === '"' || quote === "'") {
					this.char_step();
					value_tokens = this.parse_attribute_value(quote);
					this.chars_consume(quote);
				}
				else {
					// Unquoted attribute value
					value_tokens = [];
					let text = '';
					const text_position = this.position_get();

					while (this.index < this.src.length) {
						const c = this.char_current();
						if (html_is_whitespace(c) || c === '>' || c === '/') break;
						text += c;
						this.char_step();
					}

					if (text) {
						value_tokens.push({
							type: TOKEN_TEXT,
							...text_position,
							trim_before: false,
							trim_after: false,
							value: text,
						});
					}
				}
			}

			attributes.push({
				type: TOKEN_ATTRIBUTE,
				...position,
				trim_before: false,
				trim_after: false,
				name: html_attr_to_dom(name),
				value: value_tokens,
			});
		}

		return attributes;
	}

	/**
		Parses an attribute value which can contain text and liquid expressions.
		@param {string} quote - The quote character used
		@returns {Array} Array of tokens (text and/or expressions)
	*/
	parse_attribute_value(quote) {
		const tokens = [];
		let text = '';
		let text_position = this.position_get();

		while (this.index < this.src.length) {
			const char = this.char_current();

			if (char === quote) break;

			if (char === '{' && this.chars_match('{{')) {
				// Save accumulated text
				if (text) {
					tokens.push({
						type: TOKEN_TEXT,
						...text_position,
						trim_before: false,
						trim_after: false,
						value: text,
					});
					text = '';
				}

				// Parse liquid expression
				const expr_position = this.position_get();
				this.chars_consume('{{');
				const expression = this.chars_consume_until('}}', 'liquid expression');
				const varName = expression.trim();
				this.variables.set(varName, null);
				tokens.push({
					type: TOKEN_EXPRESSION,
					...expr_position,
					trim_before: false,
					trim_after: false,
					value: varName,
				});
				text_position = this.position_get();
			}
			else {
				text += char;
				this.char_step();
			}
		}

		// Add remaining text
		if (text) {
			tokens.push({
				type: TOKEN_TEXT,
				...text_position,
				trim_before: false,
				trim_after: false,
				value: text,
			});
		}

		return tokens.length === 0 ? null : tokens;
	}
}

/**
	Generic conditional helper that finds matching end tag and processes body.
	@param {Array} tokens
	@param {number} index - Index of the opening conditional token
	@param {number} index_end - End of search range (exclusive)
	@param {Function} process_body - Function to process tokens in body
	@returns {Object} {result, index} - result from process_body and index after end tag
*/
function build_conditional(tokens, index, index_end, process_body) {
	const token = tokens[index];
	const is_unless = token.command === COMMAND_UNLESS;
	const condition = token.value;
	const end_command = is_unless ? COMMAND_ENDUNLESS : COMMAND_ENDIF;

	// find matching end tag
	let depth = 1;
	let body_end = index + 1;
	for (; body_end < index_end; body_end++) {
		const t = tokens[body_end];
		if (t.type !== TOKEN_LIQUID) continue;

		if (t.command === COMMAND_IF || t.command === COMMAND_UNLESS) {
			depth++;
		}
		else if ((t.command === COMMAND_ENDIF || t.command === COMMAND_ENDUNLESS) && --depth <= 0) {
			// Accept any end tag (endif or endunless) when depth reaches 0
			break;
		}
	}

	if (depth > 0) {
		error(`Unclosed ${command_map_reverse.get(token.command)} block`, token);
	}

	// Process body with provided function
	const result = process_body(tokens, index + 1, body_end, is_unless, condition);

	return {
		result,
		index: body_end + 1,
	};
}

/**
	Build nodes from a token range.
	@param {Array} tokens
	@param {number} index start
	@param {number} index_end (exclusive)
	@param {string} condition_prefix - Optional condition prefix for flattening nested conditionals
	@returns {Array} nodes
*/
function build_nodes(tokens, index, index_end, condition_prefix = '') {
	const nodes = [];

	while (index < index_end) {
		const token = tokens[index];

		switch (token.type) {
		case TOKEN_HTML_START: {
			const node = build_element_node(tokens, index);
			if (condition_prefix) {
				// Wrap element in conditional
				nodes.push({
					type: NODE_TYPE_IF,
					condition: {
						type: VALUE_TYPE_FIELD,
						data: condition_prefix,
					},
					child: node.element,
				});
			}
			else {
				nodes.push(node.element);
			}
			index = node.index;
			continue;
		}
		case TOKEN_HTML_END:
			error(`Unexpected closing tag </${token.tag_name}>`, token);
		case TOKEN_TEXT:
		case TOKEN_EXPRESSION: {
			// merge text and expression tokens
			const merge_list = [];
			for (; index < index_end; index++) {
				const token = tokens[index];
				if (
					token.type !== TOKEN_TEXT &&
					token.type !== TOKEN_EXPRESSION
				) break;
				merge_list.push(token);
			}

			// as lui does not allow text nodes, create a span
			const innerText = build_value_trimmed(merge_list);
			if (innerText) {
				const span_node = {
					type: NODE_TYPE_ELEMENT,
					tag: 'span',
					props: {
						innerText,
					},
					children: [],
				};
				
				if (condition_prefix) {
					// Wrap span in conditional
					nodes.push({
						type: NODE_TYPE_IF,
						condition: {
							type: VALUE_TYPE_FIELD,
							data: condition_prefix,
						},
						child: span_node,
					});
				}
				else {
					nodes.push(span_node);
				}
			}
			continue;
		}
		case TOKEN_LIQUID:
			switch (token.command) {
			case COMMAND_IF:
			case COMMAND_UNLESS: {
				const conditional = build_conditional(tokens, index, index_end, (tokens, start, end, is_unless, condition) => {
					const new_condition = is_unless ? `!(${condition})` : condition;
					const combined_condition = condition_prefix 
						? `${condition_prefix} && ${new_condition}`
						: new_condition;
					
					// Build children with combined condition - this flattens nested conditionals
					const children = build_nodes(tokens, start, end, combined_condition);
					return children;
				});

				// Add all flattened children
				nodes.push(...conditional.result);
				index = conditional.index;
				continue;
			}
			case COMMAND_ENDIF:
			case COMMAND_ENDUNLESS:
			case COMMAND_ENDFOR:
				// end tags are handled by the if/unless logic above
				error(`Unexpected ${command_map_reverse.get(token.command)} without matching opening tag`, token);
			}
			default:
				error(`Unexpected liquid tag ${command_map_reverse.get(token.command)}`, token);
		}

		index++;
	}

	return nodes;
}

/**
	Builds an element node from tokens, including its children.
	@param {Array} tokens
	@param {number} index start
	@returns {Object} {element, index}
*/
function build_element_node(tokens, index) {
	const token_start = tokens[index++];

	const props = {};
	if (token_start.attributes)
	for (let index = 0; index < token_start.attributes.length; index++) {
		const token = token_start.attributes[index];

		if (token.type === TOKEN_ATTRIBUTE) {
			props[token.name] = (
				token.value === null // boolean
				?	{type: VALUE_TYPE_STATIC, data: true}
				:	build_value(token.value)
			);
			continue;
		}
		if (token.type !== TOKEN_LIQUID) error(`Unexpected attribute type ${token.type}`, token);

		// conditional attributes
		switch (token.command) {
		case COMMAND_ENDIF:
		case COMMAND_ENDUNLESS:
		case COMMAND_ENDFOR:
			// Skip end tags - they're handled by the opening if/unless
			break;
		case COMMAND_IF:
		case COMMAND_UNLESS: {
			const conditional = build_conditional(
				token_start.attributes,
				index,
				token_start.attributes.length,
				(tokens, start, end, is_unless, condition) => {
					// Process attributes in conditional body
					const result_props = {};
					for (let i = start; i < end; i++) {
						const t = tokens[i];
						if (t.type === TOKEN_LIQUID) continue; // nested conditionals handled recursively
						if (t.type !== TOKEN_ATTRIBUTE) error('Unexpected token in conditional attributes', t);

						if (t.value === null) { // boolean attribute
							result_props[t.name] = {
								type: VALUE_TYPE_FIELD,
								data: is_unless ? `!(${condition})` : condition,
							};
						}
						else { // non-boolean attribute with value
							const value = build_value(t.value);
							const value_str = (
								value.type === VALUE_TYPE_STATIC
								?	JSON.stringify(value.data)
								: value.type === VALUE_TYPE_FIELD
								?	value.data
								: 	generate_value_inline(value, t)
							);
							result_props[t.name] = {
								type: VALUE_TYPE_FIELD,
								data: is_unless
									? `${condition} ? "" : ${value_str}`
									: `${condition} ? ${value_str} : ""`,
							};
						}
					}
					return result_props;
				}
			);

			// Merge conditional props into main props
			Object.assign(props, conditional.result);
			index = conditional.index - 1; // -1 because for loop will increment
			break;
		}// case
		}// switch
	}

	let children = [];
	if (!html_is_self_closing(token_start.tag_name)) {
		const index_start = index;
		({children, index} = build_children(tokens, index, token_start.tag_name));

		text_extract: if (children.length === 0) {
			const merge_list = [];
			loop: for (let i = index_start; i < tokens.length; i++) {
				const token = tokens[i];

				switch (token.type) {
				case TOKEN_HTML_END:
					if (token.tag_name === token_start.tag_name) break loop;
				case TOKEN_LIQUID:
					// apart from loops, everything is allowed in text-only
					if (token.command !== COMMAND_FOR) break;
				case TOKEN_HTML_START:
					text_only = false;
					break text_extract;
				}

				merge_list.push(token);
			}

			const value = build_value_trimmed(merge_list);
			if (value) props.innerText = value;
		}
	}

	return {
		element: {
			type: NODE_TYPE_ELEMENT,
			tag: token_start.tag_name,
			props,
			children,
		},
		index,
	};
}

/**
	Helper to generate value inline for complex expressions.
	Should be removed in future as its hacky af.
	@param {Object} value
	@returns {string}
*/
function generate_value_inline(value, position) {
	switch (value.type) {
	case VALUE_TYPE_FIELD:
		return value.data;
	case VALUE_TYPE_STATIC:
		return JSON.stringify(value.data);
	case VALUE_TYPE_STRING_CONCAT:
		// Generate template literal
		return '`' + (
			value.data.map(part => (
				part.type === VALUE_TYPE_STATIC
				?	part.data
					.replace(/\\/g, '\\\\')
					.replace(/`/g, '\\`')
					.replace(/\$/g, '\\$')
				:	'${' + part.data + '}'
			)).join('')
		) + '`';
	}
	error(`Unsupported value type: ${value.type}`, position);
}

/**
	Builds children nodes before the end tag.
	@param {Array} tokens
	@param {number} index start
	@param {string} tag_parent
	@returns {Object} {children, index}
*/
function build_children(tokens, index, tag_parent) {
	const content = [];

	let text_only = true;
	let depth = 1;
	loop: for (; index < tokens.length; index++) {
		const token = tokens[index];

		switch (token.type) {
			case TOKEN_HTML_START:
				if (token.tag_name === tag_parent) depth++;
				text_only = false;
				break;
			case TOKEN_LIQUID:
				if (token.command === COMMAND_IF || token.command === COMMAND_UNLESS) {
					text_only = false;
				}
				break;
			case TOKEN_HTML_END:
				if (
					token.tag_name === tag_parent &&
					--depth === 0
				) {
					// skip the end tag
					index++;
					break loop;
				}
				text_only = false;
		}

		content.push(token);
	}

	// Check if we exited the loop without finding the closing tag
	if (depth > 0) {
		error(`Unclosed tag <${tag_parent}>`, tokens[index - 1] || tokens[0]);
	}

	return {
		children: (
			text_only
			?	[]
			:	build_nodes(content, 0, content.length)
		),
		index,
	};
}

/**
	Builds a value object out of text and expression tokens.
	@param {Array} tokens
	@returns {Object}
*/
function build_value(tokens) {
	// liquid trim feature {%- -%}
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		if (token.type !== TOKEN_TEXT) continue;

		const token_before = tokens[index - 1];
		const token_after = tokens[index + 1];

		if (token_before != null && token_before.trim_after) {
			token.value = token.value.trimStart();
		}
		if (token_after != null && token_after.trim_before) {
			token.value = token.value.trimEnd();
		}
	}

	const values = tokens.map(token => ({
		type: (
			token.type === TOKEN_TEXT
			?	VALUE_TYPE_STATIC
			:	VALUE_TYPE_FIELD
		),
		data: token.value,
	}));
	return (
		values.length === 1
		?	values[0]
		:	{
			type: VALUE_TYPE_STRING_CONCAT,
			data: values,
		}
	);
}

/**
	Builds a value object out of text and expression tokens.
	Trims whitespace from the start and end.
	@param {Array} tokens
	@returns {Object} value object or null
*/
function build_value_trimmed(tokens) {
	const filtered = [];

	let empty = true;
	for (const token of tokens) {
		if (token.type === TOKEN_EXPRESSION) {
			filtered.push(token);
			empty = false;
		}
		else if (token.type === TOKEN_TEXT) {
			// Keep all text, even whitespace, to preserve spacing
			filtered.push(token);
			if (token.value.trimStart()) {
				empty = false;
			}
		}
	}
	if (empty) {
		return null;
	}

	// remove spaces from start and end
	if (filtered[0].type === TOKEN_TEXT) {
		const trimmed = filtered[0].value.trimStart();
		if (trimmed) filtered[0].value = trimmed;
		else {
			filtered.shift();
			if (filtered.length === 0) return null;
		}
	}
	const last = filtered[filtered.length - 1];
	if (last.type === TOKEN_TEXT) {
		const trimmed = last.value.trimEnd();
		if (trimmed) last.value = trimmed;
		else {
			filtered.pop();
			if (filtered.length === 0) return null;
		}
	}

	return build_value(filtered);
}
