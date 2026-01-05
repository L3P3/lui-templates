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
const TOKEN_LIQUID_TAG = 5; // generic liquid tag (if/unless/endif/endunless/etc)
const TOKEN_LOOP = 6; // for node
const TOKEN_SCRIPT = 7; // liquid script node

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
		const content = this.src.slice(this.index, index_end);
		this.chars_step(index_end + limit.length - this.index);
		return content;
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
				token = this.parse_liquid(false);
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
			tag_name,
			attributes,
			...position,
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
			tag_name,
			...position,
		};
	}

	/**
		Parses a liquid block.
		@param {boolean} must_yield - Whether the block must yield a (single) value
		@returns {Object} Token
	*/
	parse_liquid(must_yield) {
		const position = this.position_get();
		if (this.chars_match('{{')) {
			this.chars_consume('{{');
			let expression = this.chars_consume_until('}}', 'liquid expression');
			const trim_before = expression.startsWith('-');
			const trim_after = expression.endsWith('-');
			expression = expression.slice(
				trim_before ? 1 : 0,
				trim_after ? -1 : undefined
			).trim();
			// TODO: see if it is really just a variable or includes pipes
			this.variables.set(expression, null);
			return {
				type: TOKEN_EXPRESSION,
				value: expression,
				trim_before,
				trim_after,
				...position,
			};
		}
		if (this.chars_match('{%')) {
			this.chars_consume('{%');
			let trim_before = false;
			if (this.chars_match('-')) {
				trim_before = true;
				this.char_step();
			}
			this.chars_skip_whitespace();

			if (this.chars_match('comment')) {
				this.chars_consume_until('endcomment', 'liquid comment');
				const rest = this.chars_consume_until('%}', 'liquid tag');
				return {
					type: TOKEN_SCRIPT,
					content: '',
					trim_before,
					trim_after: rest.endsWith('-'),
					...position,
				};
			}

			// Parse generic liquid tag
			let command = '';
			while (this.index < this.src.length) {
				const char = this.char_current();
				if (html_is_whitespace(char) || this.chars_match('%}')) break;
				command += char;
				this.char_step();
			}

			this.chars_skip_whitespace();
			
			// Get rest of content until %}
			let content = this.chars_consume_until('%}', 'liquid tag');
			const trim_after = content.endsWith('-');
			content = content.slice(0, trim_after ? -1 : undefined).trimEnd();

			// Track variables if this is a condition
			if (command === 'if' || command === 'unless') {
				this.variables.set(content, null);
			}

			return {
				type: TOKEN_LIQUID_TAG,
				command,
				content,
				trim_before,
				trim_after,
				...position,
			};
		}

		// this is not a liquid tag!
		this.char_step();
		return {
			type: TOKEN_TEXT,
			value: '{',
			...position,
		};
	}

	/**
		Parses static text content.
		@returns {Object} Token
	*/
	parse_text() {
		const position = this.position_get();
		let text = '';
		while (this.index < this.src.length) {
			const char = this.char_current();
			if (char === '<' || char === '{') break;
			text += char;
			this.char_step();
		}
		return {
			type: TOKEN_TEXT,
			value: text,
			...position,
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
				const liquid_tag = this.parse_liquid(false);
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
							value: text,
							...text_position,
						});
					}
				}
			}

			attributes.push({
				type: TOKEN_ATTRIBUTE,
				name: html_attr_to_dom(name),
				value: value_tokens,
				...position,
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
						value: text,
						...text_position,
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
					value: varName,
					...expr_position,
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
				value: text,
				...text_position,
			});
		}

		return tokens.length === 0 ? null : tokens;
	}
}

/**
	Build nodes from a token range.
	@param {Array} tokens
	@param {number} index start
	@param {number} index_end (exclusive)
	@returns {Array} nodes
*/
function build_nodes(tokens, index, index_end) {
	const nodes = [];

	while (index < index_end) {
		const token = tokens[index];

		switch (token.type) {
		case TOKEN_HTML_START: {
			const node = build_element_node(tokens, index);
			nodes.push(node.element);
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
				nodes.push({
					type: NODE_TYPE_ELEMENT,
					tag: 'span',
					props: {
						innerText,
					},
					children: [],
				});
			}
			continue;
		}
		case TOKEN_LIQUID_TAG: {
			// Handle liquid tags in build phase
			const command = token.command;
			
			if (command === 'if' || command === 'unless') {
				// Build conditional node
				const is_unless = command === 'unless';
				const condition = token.content;
				const end_tag = is_unless ? 'endunless' : 'endif';
				
				// Find matching end tag
				let depth = 1;
				let body_end = index + 1;
				for (; body_end < index_end; body_end++) {
					const t = tokens[body_end];
					if (t.type === TOKEN_LIQUID_TAG) {
						if (t.command === 'if' || t.command === 'unless') {
							depth++;
						} else if (t.command === end_tag) {
							depth--;
							if (depth === 0) break;
						}
					}
				}
				
				if (depth > 0) {
					error(`Unclosed ${command} block`, token);
				}
				
				// Build children from body
				const children = build_nodes(tokens, index + 1, body_end);
				
				nodes.push({
					type: NODE_TYPE_IF,
					condition: {
						type: VALUE_TYPE_FIELD,
						data: (
							is_unless
							?	`!(${condition})`
							:	condition
						),
					},
					child: (
						children.length === 1
						?	children[0]
						:	{
							type: NODE_TYPE_ELEMENT,
							tag: 'span',
							props: {},
							children,
						}
					),
				});
				
				// Skip past the end tag
				index = body_end + 1;
				continue;
			} else if (command === 'endif' || command === 'endunless') {
				// End tags are handled by the if/unless logic above
				// If we reach here, it's an unmatched end tag
				error(`Unexpected ${command} without matching opening tag`, token);
			}
			// Other liquid tags are ignored or handled elsewhere
		}
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
	if (token_start.attributes) {
		let attr_index = 0;
		while (attr_index < token_start.attributes.length) {
			const attr = token_start.attributes[attr_index];
			
			if (attr.type === TOKEN_LIQUID_TAG) {
				// Handle conditional liquid tags in attributes
				const command = attr.command;
				
				if (command === 'if' || command === 'unless') {
					const is_unless = command === 'unless';
					const condition = attr.content;
					const end_tag = is_unless ? 'endunless' : 'endif';
					
					// Find the matching end tag and collect attributes in between
					let depth = 1;
					let body_end = attr_index + 1;
					const body_attrs = [];
					
					for (; body_end < token_start.attributes.length; body_end++) {
						const t = token_start.attributes[body_end];
						if (t.type === TOKEN_LIQUID_TAG) {
							if (t.command === 'if' || t.command === 'unless') {
								depth++;
								// Don't add nested conditionals to body_attrs
							} else if (t.command === end_tag) {
								depth--;
								if (depth === 0) {
									// Found matching end tag, stop
									break;
								}
							}
						} else if (depth === 1 && t.type === TOKEN_ATTRIBUTE) {
							// Only collect attributes at depth 1 (direct children)
							body_attrs.push(t);
						}
					}
					
					// Check if we found the end tag
					if (body_end >= token_start.attributes.length) {
						// Didn't find matching end tag
						error(`Unclosed ${command} block in attributes`, attr);
					}
					
					// Process the attributes inside the conditional
					for (const body_attr of body_attrs) {
						const attr_name = body_attr.name;
						const is_boolean = body_attr.value === null; // Boolean if no = sign
						
						if (is_boolean) {
							// Boolean attribute: set to condition or inverted condition
							if (is_unless) {
								props[attr_name] = {
									type: VALUE_TYPE_FIELD,
									data: `!(${condition})`,
								};
							} else {
								props[attr_name] = {
									type: VALUE_TYPE_FIELD,
									data: condition,
								};
							}
						} else {
							// Non-boolean attribute: use ternary operator
							const value = build_value(body_attr.value);
							
							// Create ternary: condition ? value : ""
							// For unless, swap the order: condition ? "" : value
							if (is_unless) {
								// unless: if condition is false, use value, else empty string
								if (value.type === VALUE_TYPE_STATIC) {
									props[attr_name] = {
										type: VALUE_TYPE_FIELD,
										data: `${condition} ? "" : ${JSON.stringify(value.data)}`,
									};
								} else if (value.type === VALUE_TYPE_FIELD) {
									props[attr_name] = {
										type: VALUE_TYPE_FIELD,
										data: `${condition} ? "" : ${value.data}`,
									};
								} else {
									// STRING_CONCAT - need to generate the template literal
									props[attr_name] = {
										type: VALUE_TYPE_FIELD,
										data: `${condition} ? "" : (${generate_value_inline(value)})`,
									};
								}
							} else {
								// if: if condition is true, use value, else empty string
								if (value.type === VALUE_TYPE_STATIC) {
									props[attr_name] = {
										type: VALUE_TYPE_FIELD,
										data: `${condition} ? ${JSON.stringify(value.data)} : ""`,
									};
								} else if (value.type === VALUE_TYPE_FIELD) {
									props[attr_name] = {
										type: VALUE_TYPE_FIELD,
										data: `${condition} ? ${value.data} : ""`,
									};
								} else {
									// STRING_CONCAT - need to generate the template literal
									props[attr_name] = {
										type: VALUE_TYPE_FIELD,
										data: `${condition} ? (${generate_value_inline(value)}) : ""`,
									};
								}
							}
						}
					}
					
					// Skip past the conditional block including the endif/endunless
					attr_index = body_end + 1;
					continue;
				} else if (command === 'endif' || command === 'endunless') {
					// Skip end tags - they're handled by the opening if/unless
					attr_index++;
					continue;
				}
			} else if (attr.type === TOKEN_ATTRIBUTE) {
				// Regular attribute
				props[attr.name] = (
					attr.value === null // boolean
					?	{type: VALUE_TYPE_STATIC, data: true}
					:	build_value(attr.value)
				);
			}
			
			attr_index++;
		}
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
				case TOKEN_HTML_START:
				case TOKEN_LIQUID_TAG:
					// Check if it's an if/unless (conditionals are not text-only)
					if (token.command === 'if' || token.command === 'unless') {
						text_only = false;
					}
					// Has child elements, not pure text
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

// Helper to generate value inline for complex expressions
function generate_value_inline(value) {
	if (value.type === VALUE_TYPE_STATIC) {
		return JSON.stringify(value.data);
	} else if (value.type === VALUE_TYPE_FIELD) {
		return value.data;
	} else if (value.type === VALUE_TYPE_STRING_CONCAT) {
		// Generate template literal
		const parts = value.data.map(part => {
			if (part.type === VALUE_TYPE_STATIC) {
				return part.data.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
			} else {
				return '${' + part.data + '}';
			}
		});
		return '`' + parts.join('') + '`';
	}
	return 'undefined';
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
			case TOKEN_LIQUID_TAG:
				if (token.command === 'if' || token.command === 'unless') {
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

/**
	Builds a value object out of text and expression tokens.
	@param {Array} tokens
	@returns {Object}
*/
function build_value(tokens) {
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
