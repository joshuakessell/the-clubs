import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';

/**
 * SPA definitions — each gets its own S3 bucket + CloudFront distribution.
 */
const SPA_APPS = ['customer-kiosk', 'employee-register', 'office-dashboard'] as const;
type SpaName = (typeof SPA_APPS)[number];

interface SpaStackProps extends cdk.StackProps {
  projectName: string;
  environment: string;
  /** Map of SPA name → custom domain (empty string = use CloudFront default) */
  domains: Record<string, string>;
}

/**
 * SpaStack
 *
 * Creates one S3 bucket + CloudFront distribution per SPA app.
 * Equivalent to the Terraform `aws_s3_bucket.spa` / `aws_cloudfront_distribution.spa`
 * resources with for_each over local.spas.
 *
 * Features:
 *   - Private S3 buckets with OAC (Origin Access Control)
 *   - SPA routing (403/404 → /index.html)
 *   - Long-cache /assets/* behavior (1 year)
 *   - Optional custom domains with auto-created ACM certificate
 */
export class SpaStack extends cdk.Stack {
  /** S3 bucket ARNs — consumed by CiStack for IAM permissions */
  public readonly bucketArns: string[];
  /** CloudFront distribution ARNs — consumed by CiStack */
  public readonly distributionArns: string[];

  constructor(scope: Construct, id: string, props: SpaStackProps) {
    super(scope, id, props);

    const { projectName, domains } = props;
    const bucketArns: string[] = [];
    const distributionArns: string[] = [];

    // ── ACM Certificate (if any custom domains are set) ──────
    const customDomains = SPA_APPS.map((name) => domains[name]).filter(Boolean);
    let certificate: acm.ICertificate | undefined;

    if (customDomains.length > 0) {
      // ACM certs for CloudFront MUST be in us-east-1
      certificate = new acm.Certificate(this, 'SpaCert', {
        domainName: customDomains[0],
        subjectAlternativeNames: customDomains.slice(1),
        validation: acm.CertificateValidation.fromDns(),
      });
    }

    // ── Per-SPA resources ────────────────────────────────────
    for (const spaName of SPA_APPS) {
      const pascalName = spaName
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join('');

      // S3 bucket — private, block all public access
      const bucket = new s3.Bucket(this, `${pascalName}Bucket`, {
        bucketName: `${projectName}-${spaName}`,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
        encryption: s3.BucketEncryption.S3_MANAGED,
      });
      bucketArns.push(bucket.bucketArn);

      // Custom domain for this SPA (empty string = none)
      const domain = domains[spaName] || '';

      // CloudFront distribution
      const distribution = new cloudfront.Distribution(this, `${pascalName}Dist`, {
        comment: `${projectName} ${spaName}`,
        defaultRootObject: 'index.html',
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
        enableIpv6: true,

        // Default behavior — serves SPA files
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          compress: true,
          cachePolicy: new cloudfront.CachePolicy(this, `${pascalName}DefaultCache`, {
            defaultTtl: cdk.Duration.days(1),
            maxTtl: cdk.Duration.days(365),
            minTtl: cdk.Duration.seconds(0),
            enableAcceptEncodingGzip: true,
            enableAcceptEncodingBrotli: true,
          }),
        },

        // /assets/* — immutable hashed files, 1-year cache
        additionalBehaviors: {
          '/assets/*': {
            origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            compress: true,
            cachePolicy: new cloudfront.CachePolicy(this, `${pascalName}AssetsCache`, {
              defaultTtl: cdk.Duration.days(365),
              maxTtl: cdk.Duration.days(365),
              minTtl: cdk.Duration.days(365),
              enableAcceptEncodingGzip: true,
              enableAcceptEncodingBrotli: true,
            }),
          },
        },

        // SPA routing — serve index.html for 403/404
        errorResponses: [
          {
            httpStatus: 403,
            responseHttpStatus: 200,
            responsePagePath: '/index.html',
          },
          {
            httpStatus: 404,
            responseHttpStatus: 200,
            responsePagePath: '/index.html',
          },
        ],

        // Custom domain + SSL (optional)
        ...(domain && certificate
          ? {
              domainNames: [domain],
              certificate,
              sslSupportMethod: cloudfront.SSLMethod.SNI,
              minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
            }
          : {}),
      });
      distributionArns.push(
        `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
      );

      // ── Outputs ────────────────────────────────────────────
      new cdk.CfnOutput(this, `${pascalName}BucketName`, {
        value: bucket.bucketName,
        description: `S3 bucket for ${spaName}`,
      });
      new cdk.CfnOutput(this, `${pascalName}DistributionId`, {
        value: distribution.distributionId,
        description: `CloudFront distribution ID for ${spaName}`,
      });
      new cdk.CfnOutput(this, `${pascalName}DistributionDomain`, {
        value: distribution.distributionDomainName,
        description: `CloudFront domain for ${spaName}`,
      });
    }

    this.bucketArns = bucketArns;
    this.distributionArns = distributionArns;
  }
}
