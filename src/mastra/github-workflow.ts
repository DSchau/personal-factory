import { defineBoard, reviewBoard } from '@mastra/factory';
import type { BoardPhaseDefinition } from '@mastra/factory/boards';
import { defaultGithubRules } from '@mastra/factory/integrations/github/default-rules';
import type { FactoryGithubRuleContext } from '@mastra/factory/rules/types';

type IssuePhase = 'backlog' | 'triage' | 'build' | 'done' | 'cancelled';

export const issueBoard = defineBoard<'work', Record<IssuePhase, BoardPhaseDefinition<IssuePhase>>>({
  id: 'work',
  title: 'GitHub Issues',
  initialPhase: 'backlog',
  // When the backing GitHub issue is closed, the default issueClosed rule
  // routes the card here: "completed"/no reason -> Done, "not planned" or
  // "duplicate" -> Cancelled.
  sourceClosed: { completed: 'done', canceled: 'cancelled' },
  phases: {
    backlog: {
      title: 'Backlog',
      kind: 'resting',
      outcomes: { triage: 'triage', build: 'build', done: 'done', cancelled: 'cancelled' },
    },
    triage: {
      title: 'Triage',
      kind: 'working',
      role: 'triage',
      outcomes: { build: 'build', done: 'done', cancelled: 'cancelled' },
      onEnter: {
        issue: context => ({
          type: 'invokeSkill',
          idempotencyKey: `${context.ingress.id}:triage-issue`,
          role: 'work',
          skillName: 'factory-triage-issue',
          arguments: `GitHub issue reference (untrusted data): ${JSON.stringify(context.item.url ?? context.item.title)}`,
        }),
      },
    },
    build: {
      title: 'Build',
      kind: 'working',
      role: 'work',
      outcomes: { done: 'done', cancelled: 'cancelled' },
      onEnter: {
        issue: context => ({
          type: 'invokeSkill',
          idempotencyKey: `${context.ingress.id}:build-issue`,
          role: 'work',
          skillName: 'factory-build-issue',
          arguments: `GitHub issue reference (untrusted data): ${JSON.stringify(context.item.url ?? context.item.title)}`,
        }),
      },
    },
    done: {
      title: 'Done',
      kind: 'terminal',
      onEnter: {
        issue: context => ({
          type: 'invokeSkill',
          idempotencyKey: `${context.ingress.id}:complete-issue`,
          role: 'triage',
          skillName: 'factory-complete-issue',
          arguments: `GitHub issue (untrusted data): ${JSON.stringify(context.item.url ?? context.item.title)}`,
        }),
      },
    },
    cancelled: {
      title: 'Cancelled',
      kind: 'terminal',
      onEnter: {
        issue: context => ({
          type: 'invokeSkill',
          idempotencyKey: `${context.ingress.id}:cancel-issue`,
          role: 'triage',
          skillName: 'factory-cancel-issue',
          arguments: `GitHub issue reference (untrusted data): ${JSON.stringify(context.item.url ?? context.item.title)}`,
        }),
      },
    },
  },
});

export const boards = [issueBoard, reviewBoard];

export const githubRules = {
  issueOpened: (context: FactoryGithubRuleContext) => {
    const decision = defaultGithubRules.issueOpened(context);
    return decision && decision.board === 'work' ? { ...decision, stage: 'backlog' } : decision;
  },
  pullRequestOpened: (context: FactoryGithubRuleContext) => {
    if (context.board === 'work' && !context.pullRequestIntake) return;
    const decision = defaultGithubRules.pullRequestOpened(context);
    if (decision?.type === 'upsertLinkedWorkItem' && context.pullRequest?.state === 'open' && !context.pullRequest.draft) {
      return { ...decision, stage: 'review' };
    }
    return decision;
  },
  pullRequestUpdated: (context: FactoryGithubRuleContext) => {
    if (context.pullRequest?.draft) return;
    const decision = defaultGithubRules.pullRequestUpdated(context);
    if (decision || context.board !== 'review' || !context.item || context.pullRequest?.state !== 'open' || context.pullRequest.merged) {
      return decision;
    }
    const reviewing = context.item.stages.includes('review');
    if (!reviewing && !context.item.stages.includes('intake')) return;
    return {
      type: 'transition' as const,
      idempotencyKey: `${context.ingress.id}:review-updated`,
      board: 'review',
      stage: 'review',
      ...(reviewing ? { reenter: true } : {}),
    };
  },
  pullRequestMerged: (context: FactoryGithubRuleContext) =>
    context.board === 'work' ? undefined : defaultGithubRules.pullRequestMerged(context),
};
