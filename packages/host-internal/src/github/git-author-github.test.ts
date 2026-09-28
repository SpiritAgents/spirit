import { test } from "vitest";
import assert from "node:assert/strict";

import { parseGitHubNoreplyLogin, resolveGitCommitAuthorIdentity } from "./git-author-github.js";

test("parseGitHubNoreplyLogin extracts login from numeric noreply email", () => {
  assert.equal(
    parseGitHubNoreplyLogin("332389783+yureDesign@users.noreply.github.com"),
    "yureDesign",
  );
});

test("parseGitHubNoreplyLogin extracts login from legacy noreply email", () => {
  assert.equal(parseGitHubNoreplyLogin("octocat@users.noreply.github.com"), "octocat");
});

test("resolveGitCommitAuthorIdentity prefers linked GitHub user", () => {
  assert.deepEqual(
    resolveGitCommitAuthorIdentity({
      gitHubUser: { login: "octocat", avatar_url: "https://avatars.githubusercontent.com/u/1?v=4" },
      authorName: "Octocat",
      authorEmail: "octocat@users.noreply.github.com",
    }),
    {
      login: "octocat",
      avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
    },
  );
});

test("resolveGitCommitAuthorIdentity falls back to noreply email login", () => {
  assert.deepEqual(
    resolveGitCommitAuthorIdentity({
      authorName: "Yu",
      authorEmail: "332389783+yureDesign@users.noreply.github.com",
    }),
    {
      login: "yureDesign",
      avatarUrl: "https://github.com/yureDesign.png?size=40",
    },
  );
});
