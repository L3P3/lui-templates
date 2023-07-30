import lui_templates from '../src/main.js';

const test = async () => {
	const result = await lui_templates('templates');
	console.log(result);
}
test();
