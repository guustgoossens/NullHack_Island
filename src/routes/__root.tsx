import { TanStackDevtools } from "@tanstack/react-devtools";
import {
	createRootRoute,
	HeadContent,
	Link,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { ConvexProvider } from "convex/react";
import { convex } from "../lib/convex";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{ title: "NullHack Island — A Life of Beauty" },
		],
		links: [
			{ rel: "stylesheet", href: appCss },
			{
				rel: "preconnect",
				href: "https://fonts.googleapis.com",
			},
			{
				rel: "preconnect",
				href: "https://fonts.gstatic.com",
				crossOrigin: "",
			},
			{
				rel: "stylesheet",
				href: "https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,300;0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;500&display=swap",
			},
		],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body className="bg-stone-50 text-stone-900 antialiased">
				<ConvexProvider client={convex}>
					<Header />
					{children}
				</ConvexProvider>
				<TanStackDevtools
					config={{ position: "bottom-right" }}
					plugins={[
						{
							name: "Tanstack Router",
							render: <TanStackRouterDevtoolsPanel />,
						},
					]}
				/>
				<Scripts />
			</body>
		</html>
	);
}

function Header() {
	return (
		<header className="border-b border-stone-200 bg-stone-50/80 backdrop-blur sticky top-0 z-30">
			<div className="mx-auto max-w-6xl px-6 py-4 flex items-baseline justify-between gap-6">
				<Link
					to="/"
					className="font-serif text-2xl tracking-tight text-stone-900 hover:text-stone-700"
				>
					Null<span className="italic text-stone-500">hack</span> Island
				</Link>
				<nav className="flex items-baseline gap-5">
					<Link
						to="/"
						className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500 hover:text-stone-900"
						activeProps={{ className: "text-stone-900" }}
					>
						Lives
					</Link>
					<Link
						to="/island"
						className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500 hover:text-stone-900"
						activeProps={{ className: "text-stone-900" }}
					>
						Island
					</Link>
					<span className="font-mono text-[11px] uppercase tracking-[0.18em] text-stone-400">
						a life of beauty
					</span>
				</nav>
			</div>
		</header>
	);
}
