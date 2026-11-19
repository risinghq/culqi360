import { Title } from "@solidjs/meta";
import { MotionConfig } from "@totallynotdavid/solid-motion";
import { Loading } from "solid-js";

import { PLATFORM_NAME } from "~/shared/branding";

import { AppErrorBoundary } from "./components/feedback/error/boundary";
import { SnackBarProvider } from "./components/feedback/snack-bar-manager/snack-bar-provider";
import { NavigationGuard } from "./components/providers/navigation-guard";
import { ThemeProvider } from "./components/ui/theme/theme-context";
import { Router } from "./router";

import "./app.css";

// The application tree. The generated client entry renders it into the body of
// the static document shell (Document.tsx).
export default function App() {
  return (
    // `user` rather than motion's own `never` default, because the animation
    // helpers this replaced already honoured the preference. Motion's contract
    // is not "do not animate": positional values like height and x jump, while
    // opacity and colour still animate, since those carry meaning rather than
    // movement.
    <MotionConfig reducedMotion="user">
      <ThemeProvider>
        <SnackBarProvider>
          <Router>
            {(props) => (
              <>
                <Title>{PLATFORM_NAME}</Title>
                <Loading>
                  <AppErrorBoundary>
                    <NavigationGuard>{props.children}</NavigationGuard>
                  </AppErrorBoundary>
                </Loading>
              </>
            )}
          </Router>
        </SnackBarProvider>
      </ThemeProvider>
    </MotionConfig>
  );
}
