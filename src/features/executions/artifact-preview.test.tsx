import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArtifactPreview } from '@/features/executions/artifact-preview'

describe('ArtifactPreview', () => {
  it('formats JSON for inspection', () => {
    const html = renderToStaticMarkup(createElement(ArtifactPreview, {
      mediaType: 'application/json',
      content: '{"total":3}',
    }))

    expect(html).toContain('Aperçu JSON')
    expect(html).toContain('&quot;total&quot;: 3')
  })

  it('renders CSV as an accessible table and escapes cell content', () => {
    const html = renderToStaticMarkup(createElement(ArtifactPreview, {
      mediaType: 'text/csv; charset=utf-8',
      content: 'nom,valeur\nAlice,3\n"<script>alert(1)</script>",4',
    }))

    expect(html).toContain('<table')
    expect(html).toContain('<th scope="col"')
    expect(html).toContain('>nom</th>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('renders Markdown without enabling embedded HTML', () => {
    const html = renderToStaticMarkup(createElement(ArtifactPreview, {
      mediaType: 'text/markdown',
      content: '**Rapport**\n\n<script>alert(1)</script>',
    }))

    expect(html).toContain('<strong>Rapport</strong>')
    expect(html).not.toContain('<script>')
  })

  it('keeps plain text readable and offers no unsafe preview for binary formats', () => {
    const plainText = renderToStaticMarkup(createElement(ArtifactPreview, {
      mediaType: 'text/plain; charset=utf-8',
      content: 'ligne 1\nligne 2',
    }))
    const binary = renderToStaticMarkup(createElement(ArtifactPreview, {
      mediaType: 'application/pdf',
      content: 'not-rendered-as-html',
    }))

    expect(plainText).toContain('<pre')
    expect(plainText).toContain('ligne 1\nligne 2')
    expect(binary).toContain('Aperçu indisponible')
    expect(binary).not.toContain('not-rendered-as-html')
  })
})
