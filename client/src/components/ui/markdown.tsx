'use client';

import * as React from 'react';
import ReactMarkdown, { type Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/utils';

export interface MarkdownProps extends Options {
  className?: string;
}

const defaultComponents: NonNullable<Options['components']> = {
  a: ({ className, href, ...props }) => (
    <a
      className={cn(className)}
      href={href}
      rel={props.rel ?? 'noreferrer'}
      target={props.target ?? '_blank'}
      {...props}
    />
  ),
  img: ({ className, alt, ...props }) => (
    <img className={cn(className)} alt={alt ?? ''} {...props} />
  ),
};

export function Markdown({
  className,
  remarkPlugins,
  components,
  ...props
}: MarkdownProps) {
  return (
    <div className={cn('prose max-w-none dark:prose-invert', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, ...(remarkPlugins ?? [])]}
        components={{ ...defaultComponents, ...components }}
        {...props}
      />
    </div>
  );
}
