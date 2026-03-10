import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

interface ApiStackProps extends cdk.StackProps {
  projectName: string;
  environment: string;
  instanceType: string;
}

/**
 * ApiStack
 *
 * Single EC2 instance running the Fastify API + PostgreSQL via Docker Compose.
 * Equivalent to the Terraform `aws_instance.api`, `aws_security_group.api`,
 * `aws_eip.api`, and `aws_key_pair.deploy` resources.
 *
 * Resources:
 *   - Default VPC (looked up, not created)
 *   - Security group: SSH(22), HTTP(80), HTTPS(443), API(3000)
 *   - EC2 instance: Amazon Linux 2023, t3.micro, 20GB gp3
 *   - Elastic IP for stable address
 *   - SSH key pair (auto-generated, private key in SSM Parameter Store)
 */
export class ApiStack extends cdk.Stack {
  public readonly instance: ec2.Instance;
  public readonly elasticIp: ec2.CfnEIP;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { projectName, instanceType } = props;

    // ── VPC — use the default VPC ────────────────────────────
    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });

    // ── Security Group ───────────────────────────────────────
    const sg = new ec2.SecurityGroup(this, 'ApiSg', {
      vpc,
      securityGroupName: `${projectName}-api-sg`,
      description: 'API server — SSH, HTTP/S, API port',
      allowAllOutbound: true,
    });

    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'SSH');
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP');
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS');
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(3000), 'API');

    // ── SSH Key Pair ─────────────────────────────────────────
    const keyPair = new ec2.KeyPair(this, 'DeployKey', {
      keyPairName: `${projectName}-deploy`,
      type: ec2.KeyPairType.RSA,
    });

    // ── User Data — install Docker + Docker Compose ──────────
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      '#!/bin/bash',
      'set -e',
      'yum update -y',
      'yum install -y docker git',
      'systemctl enable docker',
      'systemctl start docker',
      'usermod -aG docker ec2-user',
      '',
      '# Docker Compose v2',
      'mkdir -p /usr/local/lib/docker/cli-plugins',
      'curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \\',
      '  -o /usr/local/lib/docker/cli-plugins/docker-compose',
      'chmod +x /usr/local/lib/docker/cli-plugins/docker-compose',
      '',
      '# Production .env — DB_PASSWORD should come from SSM or Secrets Manager',
      'cat > /home/ec2-user/.env <<EOF',
      'DB_NAME=club_operations',
      'DB_USER=clubops',
      'NODE_ENV=production',
      'CORS_ORIGINS=*',
      'EOF',
      'chown ec2-user:ec2-user /home/ec2-user/.env',
    );

    // ── EC2 Instance ─────────────────────────────────────────
    // Look up Amazon Linux 2023 AMI
    const ami = ec2.MachineImage.latestAmazonLinux2023({
      cpuType: ec2.AmazonLinuxCpuType.X86_64,
    });

    this.instance = new ec2.Instance(this, 'ApiInstance', {
      vpc,
      instanceType: new ec2.InstanceType(instanceType),
      machineImage: ami,
      securityGroup: sg,
      keyPair,
      userData,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(20, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
          }),
        },
      ],
    });

    cdk.Tags.of(this.instance).add('Name', `${projectName}-api`);
    cdk.Tags.of(this.instance).add('Service', 'api');

    // ── Elastic IP ───────────────────────────────────────────
    this.elasticIp = new ec2.CfnEIP(this, 'ApiEip', {
      instanceId: this.instance.instanceId,
      domain: 'vpc',
    });
    cdk.Tags.of(this.elasticIp).add('Name', `${projectName}-api-eip`);

    // ── Outputs ──────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ApiPublicIp', {
      value: this.elasticIp.attrPublicIp,
      description: 'Elastic IP of the API server',
    });

    new cdk.CfnOutput(this, 'ApiInstanceId', {
      value: this.instance.instanceId,
      description: 'EC2 instance ID',
    });

    new cdk.CfnOutput(this, 'SshCommand', {
      value: `ssh -i ${projectName}-deploy.pem ec2-user@${this.elasticIp.attrPublicIp}`,
      description: 'SSH command to access the API server',
    });

    new cdk.CfnOutput(this, 'SshKeyParameterName', {
      value: `/ec2/keypair/${keyPair.keyPairId}`,
      description: 'SSM parameter path for the SSH private key',
    });
  }
}
