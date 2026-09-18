import { useQuery } from '@tanstack/react-query'

import { attentionKeys, fetchAttentionItems } from '../api/attention.ts'

/**
 * What is waiting on the Handler, read by the inbox and by the nav badge that
 * carries its count onto every other screen.
 */
export const useAttentionItems = () =>
  useQuery({ queryKey: attentionKeys.all, queryFn: fetchAttentionItems })
