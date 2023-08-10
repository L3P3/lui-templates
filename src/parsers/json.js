export default async function parseJSON(src, path) {
	const parsed = JSON.parse(src);
	// that was simple, wasn't it? oh wait, we need to annoy people by enforcing a schema
	if (parsed.$schema !== 'https://l3p3.de/shr/schema/lui-templates.intermediary.json') {
		throw new Error(`Invalid schema in file: ${path}`);
	}
	// TODO validate the schema? nah... later, maybe...
	return parsed;
}
