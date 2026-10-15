import { defineBoard, reviewBoard } from '@mastra/factory';
import type { BoardPhaseDefinition } from '@mastra/factory/boards';
import { defaultGithubRules } from '@mastra/factory/integrations/github/default-rules';
import type { FactoryGithubRuleContext } from '@mastra/factory/rules/types';

type IssuePhase = 'backlog' | 'triage' | 'build' | 'review' | 'complete' | 'cancelled';

export const issueBoard = defineBoard<'work', Record<IssuePhase, BoardPhaseDefinition<IssuePhase>>>({
  id: 'work',
  title: 'GitHub Issues',
  initialPhase: 'backlog',
  sourceClosed: { completed: 'complete', canceled: 'cancelled' },
  phases: {
    backlog: {
      title: 'Backlog',
      kind: 'resting',
      outcomes: { triage: 'triage', build: 'build', cancelled: 'cancelled' },
    },
    triage: {
      title: 'Triage',
      kind: 'resting',
      outcomes: { build: 'build', cancelled: 'cancelled' },
    },
    build: {
      title: 'Build',
      kind: 'working',
      role: 'work',
      outcomes: { review: 'review', cancelled: 'cancelled' },
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
    review: {
      title: 'Review',
      kind: 'working',
      role: 'work',
      outcomes: { build: 'build', complete: 'complete', cancelled: 'cancelled' },
    },
    complete: {
      title: 'Complete',
      kind: 'terminal',
      onEnter: {
        issue: context => ({
          type: 'invokeSkill',
          idempotencyKey: `${context.ingress.id}:complete-issue`,
          role: 'triage',
          skillName: 'factory-complete-issue',
          arguments: `GitHub issue (${context.item.url ?? context.item.title})`,
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
    const decision = defaultGithubRules.pullRequestOpened(context);
    if (decision?.type === 'transition' && context.board === 'work' && context.item?.stages.includes('build')) {
      return { ...decision, stage: 'review' };
    }
    if (decision?.type === 'upsertLinkedWorkItem' && context.pullRequest?.factoryAuthored && !context.pullRequest.draft) {
      return { ...decision, stage: 'review' };
    }
    if (context.board === 'work' && context.item?.stages.includes('build') && context.pullRequest?.state === 'open' &&
        (context.actor.type === 'github' && context.actor.trusted || context.pullRequest.factoryAuthored)) {
      return {
        type: 'transition' as const,
        idempotencyKey: `${context.ingress.id}:out-for-review`,
        board: 'work',
        stage: 'review',
      };
    }
    return decision;
  },
  pullRequestMerged: (context: FactoryGithubRuleContext) => {
    const decision = defaultGithubRules.pullRequestMerged(context);
    return decision?.type === 'transition' && decision.board === 'work'
      ? { ...decision, stage: 'complete', message: { text: `Pull request #${context.pullRequest!.number} merged; issue moved to Complete.` } }
      : decision;
  },
};
