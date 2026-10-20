# CasCas UI v2 design

Made in [FigCraft](https://github.com/storytold/figcraft) 0.7.0 (open source, MIT/Apache).

- `cascas-ui-v2.figcraft`: the design file. Open it in FigCraft. Pages: Driver · Home, Map, Plan, Activity (390 × 844) and the JMB portal (1440 × 900).
- `png/`: the five screens at 2x, ready for slides and the video.
- `source/design.py` + `source/fc.py`: the script that builds the file, so the design can be changed and rebuilt:

      python design.py
      figcraft-cli run design.json --out cascas-ui-v2.figcraft
      figcraft-cli export cascas-ui-v2.figcraft -o png --format png --scale 2

The live prototype follows these screens: the tokens (colours, Inter, 18 px radius, soft shadows) are at the top of `styles.css`, and the components in its "UI v2" block.
