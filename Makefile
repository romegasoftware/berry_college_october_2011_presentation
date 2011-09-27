all: slides.html

slides.html: slides.md
	landslide slides.md -d slides.html
clean:
	-rm -f slides.html
