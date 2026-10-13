import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { authenticatePage, createWorkspace, registerUser } from "./helpers";

const databasePath = `/tmp/openpost-app-e2e-${process.env.OPENPOST_APP_E2E_PORT ?? 18180}.db`;
const sql = (value: string) => `'${value.replaceAll("'", "''")}'`;

test("Ideate starts a new generation after the previous build is cancelled", async ({
  page,
  request,
}) => {
  const auth = await registerUser(request, `ideate-cancel-${randomUUID()}@example.com`);
  const workspace = await createWorkspace(request, auth.token, "Ideate restart");
  const accountID = randomUUID();
  execFileSync("sqlite3", [
    "-cmd",
    ".timeout 5000",
    databasePath,
    `INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active)
      VALUES (${sql(accountID)},${sql(workspace.id)},${sql(accountID)},'x',${sql(accountID)},'restart-founder',X'00',1);`,
  ]);
  const receipts = new Map<
    string,
    {
      id: string;
      workspace_id: string;
      state: string;
      phase: string;
      revision: number;
    }
  >();
  const createdIDs: string[] = [];
  // Preserve the server's idempotent receipt behavior without paying for generation.
  await page.route("**/api/v1/publication-builds", async (route) => {
    const key = route.request().headers()["idempotency-key"];
    let build = receipts.get(key);
    if (!build) {
      build = {
        id: randomUUID(),
        workspace_id: workspace.id,
        state: "queued",
        phase: "queued",
        revision: 1,
      };
      receipts.set(key, build);
    }
    createdIDs.push(build.id);
    await route.fulfill({ json: build });
  });
  await page.route("**/api/v1/publication-builds/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const build = [...receipts.values()].find((value) => path.includes(value.id));
    expect(build).toBeDefined();
    if (path.endsWith("/cancel")) {
      build!.state = "cancelled";
      build!.phase = "cancelled";
      build!.revision++;
    }
    await route.fulfill({ json: build });
  });
  await authenticatePage(page, auth.token);
  await page.goto("/ideate");
  await page.getByRole("textbox").first().fill("The editor keeps source audio.");
  await page.getByTestId("composer-account-control").click();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.keyboard.press("Escape");
  const generate = page.getByRole("button", {
    name: "Give me four posts",
    exact: true,
  });
  await generate.click();
  const cancel = page.getByRole("button", { name: "Cancel", exact: true });
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect(cancel).toHaveCount(0);
  await expect(generate).toBeEnabled();
  await generate.click();
  await expect.poll(() => createdIDs.length).toBe(2);
  expect(createdIDs[1]).not.toBe(createdIDs[0]);
  await expect(cancel).toBeVisible();
});

test("Ideate restores edited alternatives and explicitly selects one draft", async ({
  page,
  request,
}, info) => {
  test.setTimeout(90_000);
  const email = `ideate-${randomUUID()}@example.com`;
  const auth = await registerUser(request, email);
  const workspace = await createWorkspace(request, auth.token, "Ideate review");
  const accountID = randomUUID(),
    buildID = randomUUID();
  const now = new Date().toISOString();
  const direction = {
    canonical_text: "The editor is faster.",
    factual_kernel: ["The editor is faster."],
    thesis: "A faster editor.",
    outcome: "shares",
    audience: "Builders",
    angle: "The improvement",
    route: "thesis_led",
    claims: [],
    media: { treatment: "none", role: "none", brief: "Text is sufficient." },
    destinations: [
      {
        account_id: accountID,
        include: true,
        reason: "Selected by the author.",
      },
    ],
  };
  const options = ["The result", "The observation", "The lesson", "The update"].map(
    (label, index) => ({
      id: `option-${index + 1}`,
      label,
      canonical_text: `${label}: the editor is faster.`,
      direction,
      destinations: [
        {
          account_id: accountID,
          platform: "x",
          objective: "shares",
          archetype: "principle",
          output_profile: "x.post",
          preview: label,
          segments: [{ body: `${label}: the editor is faster.` }],
          media: direction.media,
          claims: [],
          warnings: [],
          follow_up_notes: [],
        },
      ],
      skipped: [],
      review_flags: [],
    }),
  );
  const input = {
    idea: "The editor is faster.",
    option_count: 4,
    direction: {},
    destination_policy: "require_all",
    destinations: [
      {
        account_id: accountID,
        platform: "x",
        label: "Review founder",
        voice: { definition: {} },
        allowed_output_profiles: [
          {
            key: "x.post",
            text_limit: 280,
            max_segments: 1,
            media_max_count: 4,
            allowed_mimes: ["image/*"],
          },
        ],
      },
    ],
  };
  // Stored alternatives cross real authorized reads, durable edits, and draft handoff.
  // Go service regressions separately cover actual generation and stale selection.
  execFileSync("sqlite3", [
    "-cmd",
    ".timeout 5000",
    databasePath,
    `
    INSERT INTO social_accounts (id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted,is_active)
      VALUES (${sql(accountID)},${sql(workspace.id)},${sql(accountID)},'x',${sql(accountID)},'review-founder',X'00',1);
    INSERT INTO publication_builds (id,workspace_id,created_by_id,state,phase,revision,idempotency_key,request_fingerprint,authority_json,request_json,result_json,created_at,updated_at)
      VALUES (${sql(buildID)},${sql(workspace.id)},(SELECT id FROM users WHERE email=${sql(email)}),'ready','ready',1,${sql(buildID)},'fixture',
        json_object('UserID',(SELECT id FROM users WHERE email=${sql(email)}),'WorkspaceID',${sql(workspace.id)},'AssuredAt',${sql(now)}),
        ${sql(JSON.stringify({ input }))},${sql(JSON.stringify({ canonical_text: "", sources: [], direction, destinations: [], options, skipped: [], review_flags: [] }))},${sql(now)},${sql(now)});
  `,
  ]);
  await authenticatePage(page, auth.token);
  await page.goto(`/ideate?build=${buildID}`);
  const choices = page.getByRole("button", {
    name: "Use this post",
    exact: true,
  });
  await expect(choices).toHaveCount(4);
  for (const width of [1280, 390, 320])
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.reload();
      await expect(choices).toHaveCount(4);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: info.outputPath(`ideate-${width}-${scheme}.png`),
      });
    }
  await page.getByRole("button", { name: "Edit post text", exact: true }).first().click();
  const text = page.getByRole("textbox", { name: "Post text", exact: true });
  await text.fill("The editor now keeps up with me.");
  await expect
    .poll(async () => {
      const response = await request.get(`/api/v1/publication-builds/${buildID}`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      return (await response.json()).result.options[0].destinations[0].segments[0].body;
    })
    .toBe("The editor now keeps up with me.");
  await page.reload();
  await expect(page.getByText("The editor now keeps up with me.", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("ideate-edited.png") });
  await choices.first().focus();
  await choices.first().press("Enter");
  await expect(page).toHaveURL(/\/publications\//);
  const response = await request.get(`/api/v1/publications/${page.url().split("/").at(-1)}`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  const publication = await response.json();
  expect(publication.status).toBe("draft");
  expect(publication.renditions[0].segments[0].body).toBe("The editor now keeps up with me.");
  await page.context().storageState({ path: info.outputPath("browser-state.json") });
});
