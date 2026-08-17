import { Component, type ReactNode } from "react";

interface Props {
  readonly children: ReactNode;
}
interface State {
  readonly message?: string | undefined;
}

// layoutFlowchart throws on inconsistent IR (e.g. a hand-edited file with a
// dangling edge that slipped past the parser). Contain it to the canvas
// instead of white-screening the whole app.
export class ErrorBoundary extends Component<Props, State> {
  override state: State = {};

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  override componentDidUpdate(prevProps: Props) {
    if (prevProps.children !== this.props.children && this.state.message !== undefined) {
      this.setState({ message: undefined }); // retry once the input changes
    }
  }

  override render() {
    if (this.state.message !== undefined) {
      return <div className="canvas-error">Cannot render diagram: {this.state.message}</div>;
    }
    return this.props.children;
  }
}
