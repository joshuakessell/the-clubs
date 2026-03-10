import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

interface CiStackProps extends cdk.StackProps {
  projectName: string;
  environment: string;
  githubRepo: string;
  /** S3 bucket ARNs from SpaStack */
  spaBucketArns: string[];
  /** CloudFront distribution ARNs from SpaStack */
  cloudFrontDistributionArns: string[];
}

/**
 * CiStack
 *
 * GitHub Actions OIDC federation — no long-lived AWS keys needed.
 * Equivalent to the Terraform `aws_iam_role.github_actions_deploy`
 * and `aws_iam_role_policy.deploy_spas` resources.
 *
 * Resources:
 *   - Looks up existing GitHub OIDC provider
 *   - IAM role assumable from GitHub Actions (via OIDC)
 *   - Inline policy: S3 (list + write) + CloudFront (invalidate)
 */
export class CiStack extends cdk.Stack {
  public readonly deployRole: iam.Role;

  constructor(scope: Construct, id: string, props: CiStackProps) {
    super(scope, id, props);

    const { projectName, environment, githubRepo, spaBucketArns, cloudFrontDistributionArns } =
      props;

    // ── Look up existing GitHub OIDC provider ────────────────
    const githubOidcProvider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      'GitHubOidc',
      `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`,
    );

    // ── Deploy role ──────────────────────────────────────────
    this.deployRole = new iam.Role(this, 'GitHubActionsDeployRole', {
      roleName: `${projectName}-${environment}-github-actions-deploy`,
      assumedBy: new iam.WebIdentityPrincipal(githubOidcProvider.openIdConnectProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        },
        StringLike: {
          'token.actions.githubusercontent.com:sub': `repo:${githubRepo}:ref:refs/heads/*`,
        },
      }),
      description: `Deploy role for ${projectName} — assumed by GitHub Actions via OIDC`,
    });

    // ── S3 + CloudFront deploy policy ────────────────────────
    // Include both production and demo bucket ARNs
    const demoBucketArns = [
      `arn:aws:s3:::${projectName}-demo-employee-register`,
      `arn:aws:s3:::${projectName}-demo-customer-kiosk`,
      `arn:aws:s3:::${projectName}-demo-office-dashboard`,
    ];

    const allBucketArns = [...spaBucketArns, ...demoBucketArns];
    const allObjectArns = allBucketArns.map((arn) => `${arn}/*`);

    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'S3ListBuckets',
        effect: iam.Effect.ALLOW,
        actions: ['s3:ListBucket'],
        resources: allBucketArns,
      }),
    );

    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'S3WriteObjects',
        effect: iam.Effect.ALLOW,
        actions: ['s3:PutObject', 's3:DeleteObject'],
        resources: allObjectArns,
      }),
    );

    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CloudFrontInvalidate',
        effect: iam.Effect.ALLOW,
        actions: ['cloudfront:CreateInvalidation'],
        resources: ['*'],
      }),
    );

    // ── Outputs ──────────────────────────────────────────────
    new cdk.CfnOutput(this, 'GitHubActionsRoleArn', {
      value: this.deployRole.roleArn,
      description: 'IAM role ARN — set as GitHub repo secret AWS_ROLE_ARN',
    });
  }
}
