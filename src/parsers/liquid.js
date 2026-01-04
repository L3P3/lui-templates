import {
	NODE_TYPE_ELEMENT,
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
const TOKEN_CONDITIONAL = 5; // if/unless node
const TOKEN_LOOP = 6; // for node
const TOKEN_SCRIPT = 7; // liquid script node

export default async function parse_liquid(src, path) {
	const tokenizer = new Tokenizer(src, path);
	const tokens = tokenizer.parse_nodes();
	const nodes = nodes_from_tokens(tokens);

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

class Tokenizer {
	constructor(src, path) {
		this.src = src;
		this.path = path;
		this.index = 0;
		this.line = 1;
		this.column = 0;
		this.nodes = [];
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
		if (char == null) this.error('Unexpected end of input');
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
		if (!this.chars_match(chars)) this.error(`Expected "${chars}"`);
		this.chars_step(chars.length);
	}

	/**
		Consumes characters until the given limit is reached.
		@param {string} limit - The end delimiter
		@param {string} desc - Description of the context
	*/
	chars_consume_until(limit, desc) {
		const index_start = this.index;
		const index_end = this.src.indexOf(limit, this.index);
		if (index_end === -1) this.error(`Unclosed ${desc}`);
		const content = this.src.slice(index_start, index_end);
		this.chars_step(index_end + limit.length - this.index);
		return content;
	}

	/**
		Handles errors during tokenization.
		@param {string} message
	*/
	error(message) {
		console.error(`Syntax error in ${this.path}:${this.line}:${this.column}: ${message}`);
		process.exit(1);
	}

	/**
		Expects to be in either top level or inside a block.
		@returns {Array} Array of Tokens
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
		Parses a html start tag, including (dynamic) tag name and attributes.
		@returns {Object} Token
	*/
	parse_html_start() {
		this.chars_consume('<');
		const tag_name = this.parse_tag_name();
		const attributes = this.parse_attributes();
		this.chars_consume('>');

		return {
			type: TOKEN_HTML_START,
			tag_name,
			attributes,
		};
	}

	/**
		Parses a html end tag.
		@returns {Object} Token
	*/
	parse_html_end() {
		this.chars_consume('</');
		const tag_name = this.parse_tag_name();
		this.chars_consume('>');

		return {
			type: TOKEN_HTML_END,
			tag_name,
		};
	}

	/**
		Parses a liquid block.
		@param {boolean} must_yield - Whether the block must yield a (single) value
		@returns {Object} Token
	*/
	parse_liquid(must_yield) {
		// TODO (low priority): allow and store - at begin or end of liquid tags in the token so later, the whitespace can be removed/added to surrounding text nodes
		if (this.chars_match('{% comment')) {
			this.chars_consume_until('endcomment %}', 'liquid comment');
			return null;
		}
		if (this.chars_match('{{')) {
			this.chars_consume('{{');
			const expression = this.chars_consume_until('}}', 'liquid expression');
			const varName = expression.trim();
			this.variables.set(varName, null);
			return {
				type: TOKEN_EXPRESSION,
				value: varName,
			};
		}
		if (
			this.chars_match('{% if') ||
			this.chars_match('{% unless')
		) {
			return this.parse_liquid_conditional();
		}
		if (this.chars_match('{% for')) {
			// later, lists might be allowed inside html attributes too
			if (must_yield) this.error('Unexpected liquid loop');
			return this.parse_liquid_loop();
		}
		if (this.chars_match('{%')) {
			if (must_yield) this.error('Unexpected liquid script');
			return this.parse_liquid_script();
		}
		// this is not a liquid tag!
		this.char_step();
		return {
			type: TOKEN_TEXT,
			value: '{',
		};
	}

	/**
		Parses a liquid script tag.
		Handles stuff like variable assignments inside liquid script tags to have transformed values, other stuff is not supported for now.
		Returns nothing but defines the variables so that they can later be turned into transformations.
	*/
	parse_liquid_script() {
		this.chars_consume('{%');
		const content = this.chars_consume_until('%}', 'liquid script');
		// find variable assignments and store the variables and their definitions
		// For now, we skip liquid script tags
		return null;
	}

	/**
		Parses a liquid conditional (if/unless) block.
		@returns {Object} Token
	*/
	parse_liquid_conditional() {
		// For now, we don't support conditionals in simple templates
		this.error('Liquid conditionals are not supported in simple templates');
	}

	/**
		Parses a liquid loop (for) block.
		@returns {Object} Token
	*/
	parse_liquid_loop() {
		// For now, we don't support loops in simple templates
		this.error('Liquid loops are not supported in simple templates');
	}

	/**
		Parses static text content.
		@returns {Object} Token
	*/
	parse_text() {
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
			
			// Parse attribute name
			let name = '';
			while (this.index < this.src.length) {
				const c = this.char_current();
				if (html_is_whitespace(c) || c === '=' || c === '>' || c === '/') break;
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
					this.error('Expected quoted attribute value');
				}
			}
			
			attributes.push({
				type: TOKEN_ATTRIBUTE,
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
		
		while (this.index < this.src.length) {
			const char = this.char_current();
			
			if (char === quote) break;
			
			if (char === '{' && this.chars_match('{{')) {
				// Save accumulated text
				if (text) {
					tokens.push({
						type: TOKEN_TEXT,
						value: text,
					});
					text = '';
				}
				
				// Parse liquid expression
				this.chars_consume('{{');
				const expression = this.chars_consume_until('}}', 'liquid expression');
				const varName = expression.trim();
				this.variables.set(varName, null);
				tokens.push({
					type: TOKEN_EXPRESSION,
					value: varName,
				});
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
			});
		}
		
		return tokens.length === 0 ? null : tokens;
	}
}

/**
	Converts an array of tokens into an optimized tree of nodes.
	@param {Array} tokens - Array of tokens to convert
	@returns {Array} Array of Nodes
*/
function nodes_from_tokens(tokens) {
	const nodes = [];
	let i = 0;
	
	while (i < tokens.length) {
		const token = tokens[i];
		
		if (token.type === TOKEN_HTML_START) {
			const node = build_element_node(tokens, i);
			nodes.push(node.element);
			i = node.nextIndex;
		}
		else if (token.type === TOKEN_HTML_END) {
			// End tag without matching start - this shouldn't happen in well-formed HTML
			// but we'll just skip it
			i++;
		}
		else if (token.type === TOKEN_TEXT) {
			// Skip pure whitespace text nodes at the root level
			if (token.value.trim()) {
				// Text nodes at root level should be wrapped, but for simple templates
				// they shouldn't exist. We'll skip them.
			}
			i++;
		}
		else if (token.type === TOKEN_EXPRESSION) {
			// Expression at root level - skip for simple templates
			i++;
		}
		else {
			i++;
		}
	}
	
	return nodes;
}

/**
	Builds an element node from tokens, including its children.
	@param {Array} tokens - Array of all tokens
	@param {number} startIndex - Index of the TOKEN_HTML_START
	@returns {Object} Object with element and nextIndex
*/
function build_element_node(tokens, startIndex) {
	const startToken = tokens[startIndex];
	const tag = startToken.tag_name;
	
	// Build props from attributes
	const props = {};
	if (startToken.attributes) {
		for (const attr of startToken.attributes) {
			if (attr.value === null) {
				// Boolean attribute
				props[attr.name] = {
					type: VALUE_TYPE_STATIC,
					data: true,
				};
			}
			else if (attr.value.length === 1 && attr.value[0].type === TOKEN_TEXT) {
				// Pure static value
				props[attr.name] = {
					type: VALUE_TYPE_STATIC,
					data: attr.value[0].value,
				};
			}
			else if (attr.value.length === 1 && attr.value[0].type === TOKEN_EXPRESSION) {
				// Pure expression
				props[attr.name] = {
					type: VALUE_TYPE_FIELD,
					data: attr.value[0].value,
				};
			}
			else {
				// Mixed content - string concatenation
				const parts = attr.value.map(token => {
					if (token.type === TOKEN_TEXT) {
						return {
							type: VALUE_TYPE_STATIC,
							data: token.value,
						};
					}
					else {
						return {
							type: VALUE_TYPE_FIELD,
							data: token.value,
						};
					}
				});
				props[attr.name] = {
					type: VALUE_TYPE_STRING_CONCAT,
					data: parts,
				};
			}
		}
	}
	
	// Check if self-closing
	const isSelfClosing = html_is_self_closing(tag);
	
	let children = [];
	let nextIndex = startIndex + 1;
	
	if (!isSelfClosing) {
		// Find matching end tag and build children
		const result = build_children(tokens, nextIndex, tag);
		children = result.children;
		nextIndex = result.nextIndex;
	}
	
	// If there's only text content, set it as innerText
	if (children.length === 0 && !props.innerText) {
		// Check for text content
		const contentTokens = [];
		let i = startIndex + 1;
		while (i < tokens.length) {
			const token = tokens[i];
			if (token.type === TOKEN_HTML_END && token.tag_name === tag) {
				break;
			}
			if (token.type === TOKEN_TEXT || token.type === TOKEN_EXPRESSION) {
				contentTokens.push(token);
			}
			else {
				// Has child elements, not pure text
				contentTokens.length = 0;
				break;
			}
			i++;
		}
		
		if (contentTokens.length > 0) {
			props.innerText = build_value_from_tokens(contentTokens);
		}
	}
	
	return {
		element: {
			type: NODE_TYPE_ELEMENT,
			tag,
			props,
			children,
		},
		nextIndex,
	};
}

/**
	Builds children nodes until the matching end tag is found.
	@param {Array} tokens - Array of all tokens
	@param {number} startIndex - Index to start parsing children
	@param {string} parentTag - Parent tag name to match end tag
	@returns {Object} Object with children array and nextIndex
*/
function build_children(tokens, startIndex, parentTag) {
	const children = [];
	let i = startIndex;
	
	// Collect content tokens until we find the end tag
	const contentTokens = [];
	let depth = 1;
	
	while (i < tokens.length && depth > 0) {
		const token = tokens[i];
		
		if (token.type === TOKEN_HTML_START && token.tag_name === parentTag) {
			depth++;
		}
		else if (token.type === TOKEN_HTML_END && token.tag_name === parentTag) {
			depth--;
			if (depth === 0) {
				i++; // Skip the end tag
				break;
			}
		}
		
		contentTokens.push(token);
		i++;
	}
	
	// Check if content is pure text/expressions (for innerText)
	const hasElements = contentTokens.some(t => 
		t.type === TOKEN_HTML_START || t.type === TOKEN_HTML_END
	);
	
	if (hasElements) {
		// Parse child elements
		let j = 0;
		while (j < contentTokens.length) {
			const token = contentTokens[j];
			
			if (token.type === TOKEN_HTML_START) {
				const node = build_element_node(contentTokens, j);
				children.push(node.element);
				j = node.nextIndex;
			}
			else {
				j++;
			}
		}
	}
	
	return {
		children,
		nextIndex: i,
	};
}

/**
	Builds a value object from text and expression tokens.
	@param {Array} tokens - Array of TOKEN_TEXT and TOKEN_EXPRESSION
	@returns {Object} Value object
*/
function build_value_from_tokens(tokens) {
	// Filter out empty text
	const filtered = tokens.filter(t => 
		t.type === TOKEN_EXPRESSION || (t.type === TOKEN_TEXT && t.value.trim())
	);
	
	if (filtered.length === 0) {
		return {
			type: VALUE_TYPE_STATIC,
			data: '',
		};
	}
	
	if (filtered.length === 1) {
		const token = filtered[0];
		if (token.type === TOKEN_TEXT) {
			return {
				type: VALUE_TYPE_STATIC,
				data: token.value,
			};
		}
		else {
			return {
				type: VALUE_TYPE_FIELD,
				data: token.value,
			};
		}
	}
	
	// Multiple parts - string concatenation
	const parts = filtered.map(token => {
		if (token.type === TOKEN_TEXT) {
			return {
				type: VALUE_TYPE_STATIC,
				data: token.value,
			};
		}
		else {
			return {
				type: VALUE_TYPE_FIELD,
				data: token.value,
			};
		}
	});
	
	return {
		type: VALUE_TYPE_STRING_CONCAT,
		data: parts,
	};
}
