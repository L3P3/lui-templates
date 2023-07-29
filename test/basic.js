import lui_templates from '../src/main.js';

const test = async () => {
	const result = await lui_templates('greeting-english.test');
	console.log(result);
}
test();
