import type { ReactNode } from 'react';

export default function WorkspaceContent({ children }: { children: ReactNode }) {
  return <div className="page-content">{children}</div>;
}
