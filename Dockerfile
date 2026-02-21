# syntax=docker/dockerfile:1
# Monorepo root Dockerfile for building all services
# This is a reference; individual services have their own optimized Dockerfiles

FROM node:22-alpine AS base
WORKDIR /repo
RUN corestack enable pnpm

FROM base AS monorepo-builder
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
COPY services ./services

RUN pnpm install --frozen-lockfile
RUN pnpm run -r build
