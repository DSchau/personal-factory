import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import test from 'node:test';
import { boards, githubRules, issueBoard } from '../src/mastra/github-workflow.ts';

test('GitHub issues move straight from Backlog to Build', () => {
  assert.equal(issueBoard.initialPhase, 'backlog');
  assert.deepEqual(issueBoard.phases.backlog.outcomes, { build: 'build', done: 'done', cancelled: 'cancelled' });
  assert.equal(issueBoard.phases.backlog.onEnter, undefined);
  const build = issueBoard.phases.build.onEnter.issue({
    ingress: { id: 'test-event' },
    item: { url: 'https://example.test/issues/3' },
  });
  assert.equal(build.type, 'invokeSkill');
  assert.equal(build.role, 'work');
  assert.equal(build.skillName, undefined);
  assert.match(build.prompt, /open a pull request/);
  assert.match(build.prompt, /"https:\/\/example\.test\/issues\/3"/);
});

test('issue board only references skills bundled with @mastra/factory', () => {
  const bundled = readdirSync(new URL('../node_modules/@mastra/factory/factory-skills/', import.meta.url));
  for (const [name, phase] of Object.entries(issueBoard.phases)) {
    const decision = phase.onEnter?.issue({ ingress: { id: 'x' }, item: { url: 'https://example.test/issues/1' } });
    if (!decision) continue;
    assert.ok(
      decision.skillName === undefined || bundled.includes(decision.skillName),
      `${name} references non-bundled skill ${decision.skillName}`,
    );
  }
});

test('issue board leaves PR review to the Review board', () => {
  assert.deepEqual(Object.keys(issueBoard.phases), ['backlog', 'build', 'done', 'cancelled']);
  assert.deepEqual(issueBoard.phases.build.outcomes, { done: 'done', cancelled: 'cancelled' });
  assert.equal(boards[1].id, 'review');
});

test('closing a GitHub issue moves its card to Done or Cancelled', () => {
  // The default issueClosed rule reads this mapping to pick the target stage:
  // completed -> Done, not_planned/duplicate -> Cancelled.
  assert.deepEqual(issueBoard.sourceClosed, { completed: 'done', canceled: 'cancelled' });
  assert.equal(issueBoard.phases.done.kind, 'terminal');
  assert.equal(issueBoard.phases.cancelled.kind, 'terminal');
  // Every non-terminal stage must allow moving to both closure targets.
  for (const stage of ['backlog', 'build']) {
    assert.equal(issueBoard.allowsTransition(stage, 'done'), true, `${stage} -> done`);
    assert.equal(issueBoard.allowsTransition(stage, 'cancelled'), true, `${stage} -> cancelled`);
  }
  // Entering Done syncs the GitHub issue via the packaged completion skill.
  const invocation = issueBoard.phases.done.onEnter.issue({
    ingress: { id: 'closed-event' },
    item: { url: 'https://example.test/issues/3' },
  });
  assert.equal(invocation.skillName, 'factory-complete-issue');
  assert.equal(invocation.role, 'triage');
});

test('issue edits and comments do not re-triage (board has no triage lane)', () => {
  const base = {
    board: 'work',
    actor: { type: 'github', login: 'someone', trusted: true, factoryAuthored: false },
    item: { id: 'item-1', source: 'github-issue', url: 'https://example.test/issues/3', stages: ['backlog'] },
    ingress: { id: 'edit-event' },
  };
  const events = {
    issueEdited: { issueChange: { title: true } },
    issueCommentCreated: {},
    issueCommentEdited: {},
    issueCommentDeleted: {},
  };
  for (const [event, extra] of Object.entries(events)) {
    assert.equal(githubRules[event]({ ...base, event, ...extra }), undefined, event);
  }
});

test('PR events leave the issue in Build and track the PR separately', () => {
  const pullRequest = {
    number: 8,
    title: 'Fix issue #3',
    url: 'https://example.test/pull/8',
    state: 'open',
    factoryAuthored: true,
    draft: false,
  };
  const context = {
    board: 'work',
    item: { stages: ['build'], source: 'github-issue' },
    pullRequest,
    actor: { type: 'github', trusted: true },
    repository: { id: 1 },
    factory: { createdAt: '2026-01-01T00:00:00Z' },
    ingress: { id: 'test-event' },
  };

  assert.equal(githubRules.pullRequestOpened(context), undefined);
  assert.equal(githubRules.pullRequestMerged({ ...context, pullRequest: { ...pullRequest, merged: true } }), undefined);

  const intake = githubRules.pullRequestOpened({ ...context, pullRequestIntake: true });
  assert.equal(intake.type, 'upsertLinkedWorkItem');
  assert.equal(intake.board, 'review');
  assert.equal(intake.stage, 'review');

  const merged = githubRules.pullRequestMerged({
    ...context,
    board: 'review',
    item: { stages: ['review'], source: 'github-pr' },
    pullRequest: { ...pullRequest, merged: true },
  });
  assert.equal(merged.type, 'transition');
  assert.equal(merged.board, 'review');
  assert.equal(merged.stage, 'done');
});

test('all open, review-ready PRs invoke the existing review skill', () => {
  const context = {
    actor: { type: 'github', trusted: false },
    repository: { id: 1 },
    factory: { createdAt: '2026-01-01T00:00:00Z' },
    ingress: { id: 'new-pr' },
    pullRequest: {
      number: 9,
      title: 'External contribution',
      url: 'https://example.test/pull/9',
      state: 'open',
      factoryAuthored: false,
      draft: false,
    },
  };

  for (const factoryAuthored of [false, true]) {
    const intake = githubRules.pullRequestOpened({
      ...context,
      pullRequest: { ...context.pullRequest, factoryAuthored },
    });
    assert.equal(intake.board, 'review');
    assert.equal(intake.stage, 'review');
  }

  const reviewBoard = boards.find(board => board.id === 'review');
  const invocation = reviewBoard.phases.review.onEnter.pullRequest({
    ingress: { id: 'new-pr' },
    item: {
      id: 'item-9',
      source: 'github-pr',
      url: context.pullRequest.url,
      metadata: { githubPullRequestNumber: 9 },
    },
  });
  assert.equal(invocation.type, 'invokeSkill');
  assert.equal(invocation.skillName, 'factory-review');
  assert.equal(invocation.role, 'review');
});

test('draft PRs wait until ready, and updates rereview external PRs', () => {
  const context = {
    board: 'review',
    item: { stages: ['intake'], source: 'github-pr' },
    actor: { type: 'github', trusted: false },
    repository: { id: 1 },
    factory: { createdAt: '2026-01-01T00:00:00Z' },
    ingress: { id: 'updated-pr' },
    pullRequest: {
      number: 9,
      title: 'External contribution',
      url: 'https://example.test/pull/9',
      state: 'open',
      factoryAuthored: false,
      draft: true,
    },
  };
  assert.equal(githubRules.pullRequestOpened({ ...context, item: undefined }).stage, 'intake');
  assert.equal(githubRules.pullRequestUpdated(context), undefined);

  const ready = { ...context, pullRequest: { ...context.pullRequest, draft: false } };
  assert.deepEqual(githubRules.pullRequestUpdated(ready), {
    type: 'transition',
    idempotencyKey: 'updated-pr:review-updated',
    board: 'review',
    stage: 'review',
  });
  assert.deepEqual(githubRules.pullRequestUpdated({ ...ready, item: { stages: ['review'], source: 'github-pr' } }), {
    type: 'transition',
    idempotencyKey: 'updated-pr:review-updated',
    board: 'review',
    stage: 'review',
    reenter: true,
  });
});
