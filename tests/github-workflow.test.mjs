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
