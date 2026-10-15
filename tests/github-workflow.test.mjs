import assert from 'node:assert/strict';
import test from 'node:test';
import { issueBoard } from '../src/mastra/github-workflow.ts';

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
