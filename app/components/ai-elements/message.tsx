"use client";

import type { ComponentProps } from "react";
import { Streamdown } from "streamdown";

export function MessageResponse({ className = "", ...props }: ComponentProps<typeof Streamdown>) {
  return <Streamdown className={`message-response ${className}`.trim()} controls={false} {...props} />;
}
