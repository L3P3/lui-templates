import lui_templates from '../src/main.js';

const test = async () => {
	console.log('Testing Liquid templates...\n');
	
	// Test single greeting.liquid file
	console.log('=== greeting.liquid ===');
	const greeting = await lui_templates('templates/greeting.liquid');
	console.log(greeting);
	console.log();
	
	// Test single link.liquid file
	console.log('=== link.liquid ===');
	const link = await lui_templates('templates/link.liquid');
	console.log(link);
	console.log();
}

test();
