/**
 * Testes da resolucao do prompt versionado da Fase 3A.
 */

import { describe, expect, it } from "vitest";
import { parsePromptVersion, selectEntityIntroPrompt } from "../prompt/select-prompt.js";

describe("select-prompt", () => {
  it("le prompt_version 0.2.0 de prompts/entity_intro_pt.md", () => {
    const { promptVersion, content } = selectEntityIntroPrompt();
    expect(promptVersion).toBe("0.2.0");
    expect(content.length).toBeGreaterThan(0);
  });

  it("parsePromptVersion extrai a versao do frontmatter", () => {
    const md = "---\nprompt_version: 1.2.3\nlanguage: pt-BR\n---\n# corpo\n";
    expect(parsePromptVersion(md)).toBe("1.2.3");
  });

  it("parsePromptVersion lanca quando nao ha prompt_version", () => {
    expect(() => parsePromptVersion("---\nlanguage: pt-BR\n---\ncorpo\n")).toThrow();
  });
});
