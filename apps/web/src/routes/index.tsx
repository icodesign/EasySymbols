import { createFileRoute } from "@tanstack/react-router";
import { Converter } from "../converter";

export const Route = createFileRoute("/")({
  component: Converter,
});
