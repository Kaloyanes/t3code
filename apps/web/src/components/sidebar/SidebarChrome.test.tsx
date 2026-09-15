import { act, type ButtonHTMLAttributes, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";

const navigate = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => children,
  useCanGoBack: () => false,
  useLocation: () => null,
  useNavigate: () => navigate,
}));
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({ environments: [] }),
}));
vi.mock("../../hooks/useHandleNewThread", () => ({
  useHandleNewThread: () => ({
    activeDraftThread: null,
    activeThread: null,
  }),
}));
vi.mock("../ui/sidebar", () => ({
  SidebarFooter: ({ children }: { children: ReactNode }) => children,
  SidebarHeader: ({ children }: { children: ReactNode }) => children,
  SidebarMenu: ({ children }: { children: ReactNode }) => children,
  SidebarMenuButton: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  SidebarMenuItem: ({ children }: { children: ReactNode }) => children,
  SidebarTrigger: () => null,
  useSidebar: () => ({ isMobile: false, setOpenMobile: vi.fn() }),
}));
vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipPopup: () => null,
  TooltipTrigger: ({ render }: { render: ReactNode }) => render,
}));
vi.mock("./SidebarProviderUpdatePill", () => ({ SidebarProviderUpdatePill: () => null }));
vi.mock("./SidebarUpdatePill", () => ({
  SidebarUpdateArchitectureWarning: () => null,
  SidebarUpdatePill: () => null,
}));

import { SidebarUtilityMenu } from "./SidebarChrome";

afterEach(() => {
  navigate.mockReset();
});

it("keeps Settings available from the sidebar footer", async () => {
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(<SidebarUtilityMenu />);
  });

  const settingsButton = renderer!.root.findByProps({ "aria-label": "Settings" });
  await act(async () => settingsButton.props.onClick());

  expect(navigate).toHaveBeenCalledWith({ to: "/settings" });
});
