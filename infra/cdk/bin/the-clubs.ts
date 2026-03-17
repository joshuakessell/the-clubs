#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { SpaStack } from '../lib/spa-stack';
import { ApiStack } from '../lib/api-stack';
import { CiStack } from '../lib/ci-stack';

/**
 * The Clubs — CDK App
 *
 * Three stacks:
 *   1. SpaStack  — S3 + CloudFront for the 3 SPA frontends
 *   2. ApiStack  — EC2 instance + Security Group + Elastic IP
 *   3. CiStack   — IAM OIDC role for GitHub Actions deploys
 */
const app = new cdk.App();

// ── Read config from cdk.json context ────────────────────────
const projectName = app.node.tryGetContext('projectName') ?? 'the-clubs';
const environment = app.node.tryGetContext('environment') ?? 'production';
const awsRegion = app.node.tryGetContext('awsRegion') ?? 'us-east-1';
const githubRepo = app.node.tryGetContext('githubRepo') ?? 'joshuakessell/the-clubs';
const instanceType = app.node.tryGetContext('instanceType') ?? 't3.micro';
const domains: Record<string, string> = app.node.tryGetContext('domains') ?? {};

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: awsRegion,
};

const commonProps = { projectName, environment };

// ── Stacks ───────────────────────────────────────────────────

const spaStack = new SpaStack(app, `${projectName}-spa`, {
  env,
  description: 'S3 + CloudFront for the 3 SPA frontends',
  ...commonProps,
  domains,
});

const apiStack = new ApiStack(app, `${projectName}-api`, {
  env,
  description: 'EC2 API server + PostgreSQL',
  ...commonProps,
  instanceType,
});

const ciStack = new CiStack(app, `${projectName}-ci`, {
  env,
  description: 'GitHub Actions OIDC deploy role',
  ...commonProps,
  githubRepo,
  spaBucketArns: spaStack.bucketArns,
  cloudFrontDistributionArns: spaStack.distributionArns,
});

// Tag all resources
cdk.Tags.of(app).add('Project', projectName);
cdk.Tags.of(app).add('Environment', environment);
cdk.Tags.of(app).add('ManagedBy', 'cdk');

app.synth();
