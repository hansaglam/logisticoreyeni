import React from 'react';
import { StatusBadge, type StatusBadgeVariant } from '../ui';

export interface AccountStatusBadgeProps {
  label: string;
  variant?: StatusBadgeVariant;
}

export default function AccountStatusBadge({
  label,
  variant = 'muted',
}: AccountStatusBadgeProps) {
  return <StatusBadge label={label} variant={variant} size="sm" />;
}
