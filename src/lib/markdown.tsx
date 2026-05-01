import { Fragment, type ReactNode } from "react";

/**
 * Tiny dependency-free markdown renderer for brain files and writing entries.
 * Supports: headings, paragraphs, lists, blockquotes, fenced code, inline code,
 * bold/italic, links, hr.
 */
export function Markdown({ source }: { source: string }) {
	return <div className="prose-brain">{renderBlocks(source)}</div>;
}

function renderBlocks(source: string): ReactNode {
	const blocks: ReactNode[] = [];
	const lines = source.replace(/\r\n/g, "\n").split("\n");
	let i = 0;
	let key = 0;

	while (i < lines.length) {
		const line = lines[i];

		// Fenced code
		if (line.startsWith("```")) {
			const codeLines: string[] = [];
			i++;
			while (i < lines.length && !lines[i].startsWith("```")) {
				codeLines.push(lines[i]);
				i++;
			}
			i++; // skip closing ```
			blocks.push(
				<pre key={key++}>
					<code>{codeLines.join("\n")}</code>
				</pre>,
			);
			continue;
		}

		// Heading
		const heading = /^(#{1,6})\s+(.*)$/.exec(line);
		if (heading) {
			const level = heading[1].length;
			const text = heading[2];
			const Tag = `h${Math.min(level, 6)}` as
				| "h1"
				| "h2"
				| "h3"
				| "h4"
				| "h5"
				| "h6";
			blocks.push(<Tag key={key++}>{renderInline(text)}</Tag>);
			i++;
			continue;
		}

		// Horizontal rule
		if (/^-{3,}$/.test(line.trim()) || /^\*{3,}$/.test(line.trim())) {
			blocks.push(<hr key={key++} />);
			i++;
			continue;
		}

		// Blockquote (collapse contiguous)
		if (line.startsWith(">")) {
			const quoteLines: string[] = [];
			while (i < lines.length && lines[i].startsWith(">")) {
				quoteLines.push(lines[i].replace(/^>\s?/, ""));
				i++;
			}
			blocks.push(
				<blockquote key={key++}>
					{renderInline(quoteLines.join(" "))}
				</blockquote>,
			);
			continue;
		}

		// Lists (collapse contiguous)
		if (/^\s*[-*+]\s+/.test(line)) {
			const items: string[] = [];
			while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
				items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
				i++;
			}
			blocks.push(
				<ul key={key++}>
					{items.map((it) => (
						<li key={it}>{renderInline(it)}</li>
					))}
				</ul>,
			);
			continue;
		}
		if (/^\s*\d+\.\s+/.test(line)) {
			const items: string[] = [];
			while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
				items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
				i++;
			}
			blocks.push(
				<ol key={key++}>
					{items.map((it) => (
						<li key={it}>{renderInline(it)}</li>
					))}
				</ol>,
			);
			continue;
		}

		// Empty line
		if (line.trim() === "") {
			i++;
			continue;
		}

		// Paragraph (collapse contiguous non-empty lines)
		const paraLines: string[] = [];
		while (
			i < lines.length &&
			lines[i].trim() !== "" &&
			!lines[i].startsWith("#") &&
			!lines[i].startsWith(">") &&
			!lines[i].startsWith("```") &&
			!/^\s*[-*+]\s+/.test(lines[i]) &&
			!/^\s*\d+\.\s+/.test(lines[i])
		) {
			paraLines.push(lines[i]);
			i++;
		}
		blocks.push(<p key={key++}>{renderInline(paraLines.join(" "))}</p>);
	}

	return blocks;
}

function renderInline(text: string): ReactNode {
	// Order: code → bold → italic → link.
	const parts: ReactNode[] = [];
	let rest = text;
	let key = 0;

	const tokenRegex =
		/(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/;

	while (rest.length > 0) {
		const match = tokenRegex.exec(rest);
		if (!match) {
			parts.push(<Fragment key={key++}>{rest}</Fragment>);
			break;
		}
		const before = rest.slice(0, match.index);
		if (before) parts.push(<Fragment key={key++}>{before}</Fragment>);

		const tok = match[0];
		if (tok.startsWith("`")) {
			parts.push(<code key={key++}>{tok.slice(1, -1)}</code>);
		} else if (tok.startsWith("**") || tok.startsWith("__")) {
			parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
		} else if (tok.startsWith("*") || tok.startsWith("_")) {
			parts.push(<em key={key++}>{tok.slice(1, -1)}</em>);
		} else if (tok.startsWith("[")) {
			const linkMatch = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok);
			if (linkMatch) {
				parts.push(
					<a
						key={key++}
						href={linkMatch[2]}
						target="_blank"
						rel="noreferrer"
						className="underline decoration-stone-400 underline-offset-2 hover:text-stone-600"
					>
						{linkMatch[1]}
					</a>,
				);
			}
		}
		rest = rest.slice(match.index + tok.length);
	}

	return <>{parts}</>;
}
