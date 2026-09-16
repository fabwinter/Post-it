"""Pure creation-time design tests, without loading APIs or credentials."""
import ast
import copy
import math
import pathlib
import unittest
import uuid

source = pathlib.Path(__file__).resolve().parents[1] / "backend" / "server.py"
tree = ast.parse(source.read_text())
nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_seed_brand_design"]
scope = {"math": math, "uuid": uuid,
         "DEFAULT_DARK_COLORS": {"bg": "#000000", "fg": "#ffffff", "sub": "#aaaaaa", "accent": "#00ff00"},
         "DEFAULT_LIGHT_COLORS": {"bg": "#ffffff", "fg": "#000000", "sub": "#333333", "accent": "#00ff00"}}
exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), "exec"), scope)
seed = scope["_seed_brand_design"]


class StartingPoints(unittest.TestCase):
    def setUp(self):
        self.assets = [{"type": "scene", "spec": {"template": "slide", "heading": "Headline", "body": "Body"}}]
        self.brand = {"fonts": {"display": "Lora", "body": "Inter"}, "logo_url": "logo.png",
                      "guideline": {"typography": {"h1": {"size": 44, "weight": 700, "line_height": 1.5}}}}

    def test_direct_canvas_units_and_editable_logo(self):
        spec = seed(self.assets, self.brand)[0]["spec"]
        heading, body, logo = spec["elements"]
        self.assertEqual(heading["fontSize"], 44)
        self.assertEqual(heading["fontFamily"], "Lora")
        self.assertEqual(heading["lineHeight"], 1.5)
        self.assertEqual(body["fontSize"], 18)
        self.assertEqual(logo["type"], "image")
        self.assertAlmostEqual(logo["x"] + logo["w"], 100 - 16 / 440 * 100)
        self.assertNotIn("brandTypeRole", heading)

    def test_template_wins_even_without_custom_layout(self):
        before = copy.deepcopy(self.assets)
        for template in [{}, {"layouts": {}}, {"layouts": {"slide": [{"fontSize": 80}]}}]:
            self.assertEqual(seed(self.assets, self.brand, template), before)

    def test_edits_survive_reseeding_and_brand_changes(self):
        result = seed(self.assets, self.brand)
        elements = result[0]["spec"]["elements"]
        elements[0].update(fontFamily="Arial", fontSize=55, color="#123456")
        elements.pop()  # logo can be deleted
        before = copy.deepcopy(result)
        self.brand["guideline"]["typography"]["h1"]["size"] = 6
        self.assertEqual(seed(result, self.brand), before)

    def test_no_brand_does_not_change_existing_assets(self):
        before = copy.deepcopy(self.assets)
        self.assertEqual(seed(self.assets, None), before)

    def test_invalid_sizes_use_readable_canvas_defaults(self):
        self.brand["guideline"]["typography"] = {"h1": {"size": -3}, "body": {"size": "nan"}}
        elements = seed(self.assets, self.brand)[0]["spec"]["elements"]
        self.assertEqual([el["fontSize"] for el in elements[:2]], [30, 18])


if __name__ == "__main__":
    unittest.main()
