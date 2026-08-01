import { LoaderCircle } from "lucide-react";

export default function Loading() {
  return <div className="workspace-state full-page route-loading"><LoaderCircle className="drawer-spinner" size={25} /><strong>Opening research workspace</strong><span>Loading the requested route.</span></div>;
}
