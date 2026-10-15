import assert from 'node:assert/strict';
import test from 'node:test';
import { boards, githubRules, issueBoard } from '../src/mastra/github-workflow.ts';

test('GitHub issues can move from Backlog through Triage to Build', () => {
  assert.equal(issueBoard.phases.backlog.outcomes.triage, 'triage');
  assert.equal(issueBoard.phases.triage.title, 'Triage');
  assert.equal(issueBoard.phases.triage.outcomes.build, 'build');
  assert.equal(issueBoard.phases.backlog.outcomes.build, 'build');
  assert.equal(issueBoard.phases.build.onEnter.issue({
    ingress: { id: 'test-event' },
    item: { url: 'https://example.test/issues/3' },
  }).skillName, 'factory-build-issue');
});

test('issue board leaves PR review and completion to the Review board', () => {
  assert.deepEqual(Object.keys(issueBoard.phases), ['backlog', 'triage', 'build', 'cancelled']);
  assert.deepEqual(issueBoard.phases.build.outcomes, { cancelled: 'cancelled' });
  assert.equal(issueBoard.sourceClosed, undefined);
  assert.equal(boards[1].id, 'review');
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
