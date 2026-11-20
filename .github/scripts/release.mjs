import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import manifest from "../../package.json" with { type: "json" };

const { version } = manifest;

const {
	GITHUB_REF_NAME: tag,
	GITHUB_OUTPUT,
	IMAGE_OWNER,
	RUNNER_TEMP,
} = process.env;
const match = tag?.match(
	/^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*))\.(?:0|[1-9]\d*)(-[A-Za-z\d-]+(?:\.[A-Za-z\d-]+)*)?$/,
);
if (!match || tag !== `v${version}`)
	throw new Error("The release tag must match the version in package.json.");

const changelog = readFileSync(
	new URL("../../CHANGELOG.md", import.meta.url),
	"utf8",
);
const sections = changelog.split(/^## /m);
const section = sections.find(
	(text) =>
		text.startsWith(`[${version}]`) ||
		text === version ||
		text.startsWith(`${version} `) ||
		text.startsWith(`${version}\n`),
);
const notes = section?.slice(section.indexOf("\n") + 1).trim();
if (!notes) throw new Error(`CHANGELOG.md needs an entry for ${version}.`);
writeFileSync(join(RUNNER_TEMP, "release-notes.md"), `${notes}\n`);

const image = `ghcr.io/${IMAGE_OWNER.toLowerCase()}/tax-tracker`;
const prerelease = Boolean(match[2]);
const tags = [`${image}:${tag}`];
if (!prerelease) tags.push(`${image}:${match[1]}`, `${image}:latest`);
appendFileSync(
	GITHUB_OUTPUT,
	[
		`version=${version}`,
		`prerelease=${prerelease}`,
		"tags<<TAGS",
		...tags,
		"TAGS",
		"",
	].join("\n"),
);
