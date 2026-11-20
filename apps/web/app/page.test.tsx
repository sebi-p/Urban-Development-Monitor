import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../messages/en.json";
import ro from "../messages/ro.json";
import HomePage from "./page";

describe("HomePage", () => {
  it("renders the Romanian title by default", () => {
    render(
      <NextIntlClientProvider locale="ro" messages={ro}>
        <HomePage />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Monitor Dezvoltare Urbană",
    );
  });

  it("has the same message keys in every locale", () => {
    expect(Object.keys(en.Home).sort()).toEqual(Object.keys(ro.Home).sort());
  });
});
