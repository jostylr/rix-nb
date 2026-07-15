import MarkdownIt from "markdown-it";
import "./styles.css";

const source = document.querySelector("#markdown-source");
const preview = document.querySelector("#markdown-preview");
const status = document.querySelector("#document-status");

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
});

function render() {
  preview.innerHTML = markdown.render(source.value);
}

source.addEventListener("input", render);

window.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    status.textContent = "Saving arrives with project files";
  }
});

render();
