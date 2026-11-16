import { describe, expect, it } from "vitest";
import { isLocalAiEndpoint } from "../src/endpoint.js";

describe("isLocalAiEndpoint", () => {
	it.each([
		"http://localhost:11434/v1",
		"http://127.0.0.1:11434/v1",
		"http://[::1]:11434/v1",
		"http://ollama:11434/v1",
		"http://host.docker.internal:11434/v1",
		"http://gpu-box.local:11434/v1",
		"http://192.168.1.20:11434/v1",
		"http://10.0.0.5/v1",
		"http://172.20.0.2/v1",
	])("treats %s as local", (url) => expect(isLocalAiEndpoint(url)).toBe(true));

	it.each([
		"https://api.openai.com/v1",
		"https://openrouter.ai/api/v1",
		"http://172.32.0.1/v1",
		"http://8.8.8.8/v1",
		"not a url",
	])("treats %s as cloud", (url) => expect(isLocalAiEndpoint(url)).toBe(false));
});
