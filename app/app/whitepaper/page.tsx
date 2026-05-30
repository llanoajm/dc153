import { promises as fs } from "fs"
import path from "path"
import type { ComponentProps } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

// Gated GridAgent whitepaper route at `/app/whitepaper`. proxy.ts gates `/app/**`,
// so any unauthenticated request bounces to `/login?next=…`. The markdown is
// rendered with react-markdown + remark-gfm (tables, code fences, lists) and
// styled with explicit Tailwind classes so it reads like a proper technical
// document rather than raw monospace text.

type MdProps = { children?: React.ReactNode }
type CodeProps = ComponentProps<"code"> & { inline?: boolean }
type AnchorProps = ComponentProps<"a">

const markdownComponents = {
  h1: ({ children }: MdProps) => (
    <h1 className="font-mark text-3xl md:text-4xl font-medium tracking-tight mt-10 mb-4 text-black">
      {children}
    </h1>
  ),
  h2: ({ children }: MdProps) => (
    <h2 className="font-mark text-2xl font-medium tracking-tight mt-10 mb-3 text-black">
      {children}
    </h2>
  ),
  h3: ({ children }: MdProps) => (
    <h3 className="font-mark text-xl font-medium mt-7 mb-2 text-black">{children}</h3>
  ),
  p: ({ children }: MdProps) => (
    <p className="font-soft text-[15px] leading-[1.65] my-3 text-black/85">{children}</p>
  ),
  ul: ({ children }: MdProps) => (
    <ul className="font-soft text-[15px] leading-[1.65] my-3 ml-6 list-disc space-y-1 text-black/85">
      {children}
    </ul>
  ),
  ol: ({ children }: MdProps) => (
    <ol className="font-soft text-[15px] leading-[1.65] my-3 ml-6 list-decimal space-y-1 text-black/85">
      {children}
    </ol>
  ),
  li: ({ children }: MdProps) => <li className="pl-1">{children}</li>,
  hr: () => <hr className="my-10 border-black/10" />,
  blockquote: ({ children }: MdProps) => (
    <blockquote className="font-soft text-[15px] my-4 pl-4 border-l-2 border-black/25 text-black/70 italic">
      {children}
    </blockquote>
  ),
  strong: ({ children }: MdProps) => (
    <strong className="font-semibold text-black">{children}</strong>
  ),
  em: ({ children }: MdProps) => <em className="italic">{children}</em>,
  a: ({ href, children }: AnchorProps) => (
    <a href={href} className="text-blue-700 underline hover:text-blue-900">
      {children}
    </a>
  ),
  table: ({ children }: MdProps) => (
    <div className="my-5 overflow-x-auto">
      <table className="w-full border-collapse font-soft text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }: MdProps) => <thead>{children}</thead>,
  tbody: ({ children }: MdProps) => <tbody>{children}</tbody>,
  tr: ({ children }: MdProps) => (
    <tr className="border-b border-black/10 last:border-b-0">{children}</tr>
  ),
  th: ({ children }: MdProps) => (
    <th className="px-3 py-2 text-left align-top font-medium text-black bg-black/[0.04]">
      {children}
    </th>
  ),
  td: ({ children }: MdProps) => (
    <td className="px-3 py-2 align-top text-black/85">{children}</td>
  ),
  code: ({ inline, children, className }: CodeProps) => {
    if (inline) {
      return (
        <code className="font-mono text-[13px] px-1 py-0.5 bg-black/[0.06] rounded text-black/90">
          {children}
        </code>
      )
    }
    return <code className={className}>{children}</code>
  },
  pre: ({ children }: MdProps) => (
    <pre className="font-mono text-[12.5px] leading-snug my-5 p-4 bg-black/[0.04] rounded overflow-x-auto whitespace-pre text-black/90">
      {children}
    </pre>
  ),
}

export default async function SteinmetzWhitepaperPage() {
  const file = path.join(
    process.cwd(),
    "app",
    "app",
    "whitepaper",
    "STEINMETZ_WHITEPAPER.md",
  )
  let markdown: string
  try {
    markdown = await fs.readFile(file, "utf8")
  } catch {
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto w-full px-6 py-12 font-soft text-black/60">
          Whitepaper not staged. Drop{" "}
          <code className="font-mono">STEINMETZ_WHITEPAPER.md</code> into{" "}
          <code className="font-mono">app/app/whitepaper/</code>.
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-white">
      <article className="max-w-3xl mx-auto w-full px-6 py-12">
        <header className="mb-10">
          <p className="font-mark text-xs tracking-[0.18em] text-black/45 uppercase">
            GridAgent · draft v0.1
          </p>
        </header>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {markdown}
        </ReactMarkdown>
      </article>
    </div>
  )
}
